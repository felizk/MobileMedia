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
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }) as WorkboxPlugin
    ]
  })
);

// The page's very first browse request can race ahead of this service
// worker taking control (clientsClaim() only kicks in once activation
// completes), so the root listing wouldn't otherwise be cached until a
// second visit. Warm it eagerly on install so "offline home" always works.
self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(MEDIA_BROWSE_ROOT_URL)
      .then((response) => {
        if (response.ok) return caches.open(MEDIA_BROWSE_CACHE).then((cache) => cache.put(MEDIA_BROWSE_ROOT_URL, response));
      })
      .catch(() => {
        // No network at install time — nothing to warm, the app just
        // falls back to the normal "not saved offline" messaging.
      })
  );
});

// Offline video caching: serve fully-downloaded video/audio files from
// IndexedDB (with Range support), falling back to the network otherwise.
self.addEventListener("fetch", (event) => {
  const destination = event.request.destination;
  if (destination !== "video" && destination !== "audio") return;

  event.respondWith(
    getVideoCacheResponse(event.request).then((cached) => cached ?? fetch(event.request))
  );
});

self.addEventListener("message", (event) => {
  const data = event.data as ClientMessage;
  if (data?.type !== "download-video") return;

  const client = event.source;
  const postToClient = (message: WorkerMessage) => {
    if (client && "postMessage" in client) client.postMessage(message);
  };

  const downloadManager = new DownloadManager(data.videoId, data.url);
  const storageManager = new StorageManager(data.videoId);

  storageManager.onprogress = (progress) => {
    postToClient({ type: "download-progress", videoId: data.videoId, progress });
  };
  storageManager.ondone = () => {
    postToClient({ type: "download-done", videoId: data.videoId });
  };
  storageManager.onerror = (error) => {
    postToClient({ type: "download-error", videoId: data.videoId, message: error.message });
  };

  downloadManager.attachFlushHandler((fileMeta, fileChunk, isDone) => {
    void storageManager.storeChunk(fileMeta, fileChunk, isDone);
  });

  event.waitUntil(
    downloadManager.run().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown download error.";
      postToClient({ type: "download-error", videoId: data.videoId, message });
    })
  );
});
