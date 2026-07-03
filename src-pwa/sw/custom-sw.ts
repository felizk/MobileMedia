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
