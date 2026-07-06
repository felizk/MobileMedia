/*
 * This file (which will be your service worker)
 * is picked up by the build system ONLY if
 * quasar.config file > pwa > workboxMode is set to "InjectManifest"
 */

import { clientsClaim } from "workbox-core";
import { NavigationRoute, registerRoute } from "workbox-routing";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute
} from "workbox-precaching";
import type { WorkboxPlugin } from "workbox-core";
import { NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

import DownloadManager from "./offline-video/download-manager";
import StorageManager from "./offline-video/storage-manager";
import getVideoCacheResponse from "./offline-video/video-cache";
import getIDBConnection from "./offline-video/idb-connection";
import type { ClientMessage, WorkerMessage } from "./offline-video/types";

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

void self.skipWaiting();
clientsClaim();

// Use with precache injection
precacheAndRoute(self.__WB_MANIFEST);

cleanupOutdatedCaches();

if (import.meta.env.QUASAR_PROD) {
  // Non-SSR fallbacks to index.html
  // Production SSR fallbacks to offline.html (except for dev)
  registerRoute(
    new NavigationRoute(
      createHandlerBoundToURL(import.meta.env.QUASAR_PWA_FALLBACK_HTML),
      {
        denylist: [
          new RegExp(import.meta.env.QUASAR_PWA_SERVICE_WORKER_REGEX),
          /workbox-(.)*\.js$/
        ]
      }
    )
  );
}

// Media directory listings: prefer live data, but fall back to the last
// listing seen for a given path when offline, so browsing (of previously
// visited folders) still works without a connection.
const MEDIA_BROWSE_CACHE = "media-browse";
const MEDIA_BROWSE_ROOT_URL = "https://mmbe.felizk.net/api/media/browse/";

registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin === "https://mmbe.felizk.net" &&
    url.pathname.startsWith("/api/media/browse/"),
  new NetworkFirst({
    cacheName: MEDIA_BROWSE_CACHE,
    networkTimeoutSeconds: 4,
    // Workbox's plugin classes aren't typed cleanly under
    // exactOptionalPropertyTypes; WorkboxPlugin is a structural interface,
    // so this cast is just accommodating that upstream gap.
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }) as WorkboxPlugin,
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 7 * 24 * 60 * 60
      }) as WorkboxPlugin
    ]
  })
);

// The page's very first browse request can race ahead of this service
// worker taking control (clientsClaim() only kicks in once activation
// completes), so the root listing wouldn't otherwise be cached until a
// second visit. Warm it eagerly on install so "offline home" always works.
self.addEventListener("install", event => {
  event.waitUntil(
    fetch(MEDIA_BROWSE_ROOT_URL)
      .then(response => {
        if (response.ok)
          return caches
            .open(MEDIA_BROWSE_CACHE)
            .then(cache => cache.put(MEDIA_BROWSE_ROOT_URL, response));
      })
      .catch(() => {
        // No network at install time — nothing to warm, the app just
        // falls back to the normal "not saved offline" messaging.
      })
  );
});

// Offline video caching: serve fully-downloaded video/audio files from
// IndexedDB (with Range support), falling back to the network otherwise.
self.addEventListener("fetch", event => {
  const destination = event.request.destination;
  if (destination !== "video" && destination !== "audio") return;

  event.respondWith(
    getVideoCacheResponse(event.request).then(
      cached => cached ?? fetch(event.request)
    )
  );
});

/**
 * In-flight downloads, keyed by videoId, so a `cancel-video` message can
 * stop the manager pair for a running download. The server's queue is the
 * page's concern; this only tracks work actually executing in the worker.
 */
interface ActiveDownload {
  downloadManager: DownloadManager;
  storageManager: StorageManager;
  /** Resolves once `run()` has fully settled (never rejects). */
  finished: Promise<void>;
}
const activeDownloads = new Map<string, ActiveDownload>();

self.addEventListener("message", event => {
  const data = event.data as ClientMessage;
  if (
    data?.type !== "download-video" &&
    data?.type !== "delete-video" &&
    data?.type !== "cancel-video"
  )
    return;

  const client = event.source;
  const postToClient = (message: WorkerMessage) => {
    if (client && "postMessage" in client) client.postMessage(message);
  };

  if (data.type === "delete-video") {
    event.waitUntil(
      (async () => {
        const db = await getIDBConnection();
        const files = await db.file.getByVideoId(data.videoId);
        await db.removeVideo(data.videoId, files);
        postToClient({ type: "delete-done", videoId: data.videoId });
      })().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown delete error.";
        postToClient({ type: "delete-error", videoId: data.videoId, message });
      })
    );
    return;
  }

  if (data.type === "cancel-video") {
    event.waitUntil(
      (async () => {
        const active = activeDownloads.get(data.videoId);
        if (active) {
          // Stop new writes first, then unwind the read loop, then wait for
          // any already-dispatched write to land — only after all of that is
          // it safe to purge, or an in-flight chunk could be re-persisted.
          active.storageManager.cancel();
          active.downloadManager.cancel();
          activeDownloads.delete(data.videoId);
          await active.finished;
          await active.storageManager.settled();
        }
        // Purge whatever partial bytes the download (or a prior failed one)
        // left behind, so nothing half-downloaded remains.
        const db = await getIDBConnection();
        const files = await db.file.getByVideoId(data.videoId);
        await db.removeVideo(data.videoId, files);
        postToClient({ type: "cancel-done", videoId: data.videoId });
      })().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown cancel error.";
        postToClient({ type: "cancel-error", videoId: data.videoId, message });
      })
    );
    return;
  }

  // Only a download-video message remains.
  event.waitUntil(
    (async () => {
      // A retry (or auto re-enqueue) can arrive while a previous manager for
      // this video is still running — e.g. its socket stalled on a network
      // change instead of erroring promptly, or it's still unwinding after a
      // failure. Two managers writing the same IDB rows corrupt each other's
      // byte accounting and can leave a truncated file marked complete, so
      // tear the old one down before starting a new one. Unlike `cancel-video`
      // this keeps the partial bytes on disk so the new download resumes from
      // them. Removing the entry first makes the old manager's own cleanup a
      // no-op (its guards see it's been replaced), so no spurious error fires.
      const existing = activeDownloads.get(data.videoId);
      if (existing) {
        activeDownloads.delete(data.videoId);
        existing.storageManager.cancel();
        existing.downloadManager.cancel();
        await existing.finished;
        await existing.storageManager.settled();
      }

      const downloadManager = new DownloadManager(data.videoId, data.url);
      const storageManager = new StorageManager(data.videoId);

      storageManager.onprogress = progress => {
        postToClient({
          type: "download-progress",
          videoId: data.videoId,
          progress
        });
      };
      storageManager.ondone = () => {
        postToClient({ type: "download-done", videoId: data.videoId });
      };
      storageManager.onerror = error => {
        postToClient({
          type: "download-error",
          videoId: data.videoId,
          message: error.message
        });
      };

      downloadManager.attachFlushHandler((fileMeta, fileChunk, isDone) => {
        void storageManager.storeChunk(fileMeta, fileChunk, isDone);
      });

      const finished = downloadManager
        .run()
        .catch((error: unknown) => {
          // A cancelled download resolves cleanly, so reaching here is a real
          // failure. Suppress it once cancel has taken this entry over.
          if (
            activeDownloads.get(data.videoId)?.downloadManager !==
            downloadManager
          )
            return;
          const message =
            error instanceof Error ? error.message : "Unknown download error.";
          postToClient({
            type: "download-error",
            videoId: data.videoId,
            message
          });
        })
        // Any chunk writes dispatched before the failure are still in flight —
        // wait for them so a `cancel-video` purge triggered right after (e.g. a
        // redownload) can't race one landing after the purge and resurrecting a
        // stale chunk/fileMeta row, which would collide with the fresh
        // download's writes on the unique video-chunk index.
        .then(() => storageManager.settled())
        .finally(() => {
          // Leave the entry in place if a newer download has already replaced it.
          if (
            activeDownloads.get(data.videoId)?.downloadManager ===
            downloadManager
          )
            activeDownloads.delete(data.videoId);
        });

      activeDownloads.set(data.videoId, {
        downloadManager,
        storageManager,
        finished
      });
      await finished;
    })()
  );
});
