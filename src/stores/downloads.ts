import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  onDownloadMessage,
  requestVideoCancel,
  requestVideoCancelAndWait,
  requestVideoDelete,
  requestVideoDownload,
  type OfflineVideoMessage
} from "@/services/offline-video";
import { getDownloadedVideos } from "@/services/offline-video-status";

/** How many videos the service worker is asked to download at once. */
const MAX_CONCURRENT_DOWNLOADS = 3;
const QUEUE_STORAGE_KEY = "mm-download-queue";
const DOWNLOADED_ONLY_STORAGE_KEY = "mm-downloaded-only";

export type DownloadStatus = "queued" | "downloading" | "done" | "error";

export interface DownloadItem {
  /** Source-tree file path; also the id used for offline storage. */
  videoId: string;
  /** Media stream URL the bytes are fetched from. */
  url: string;
  /** Display name (file name). */
  name: string;
  status: DownloadStatus;
  /** Fraction 0–1, null before the first progress report. */
  progress: number | null;
  error?: string;
}

interface PersistedItem {
  videoId: string;
  url: string;
  name: string;
}

/**
 * Client-side download queue. Downloads themselves run in the service
 * worker; this store decides *when* to ask for each one so that at most
 * `MAX_CONCURRENT_DOWNLOADS` run simultaneously, tracks progress, and
 * knows which videos are fully downloaded.
 */
export const useDownloadsStore = defineStore("downloads", () => {
  const items = ref(new Map<string, DownloadItem>());
  const downloadedIds = ref(new Set<string>());
  /** videoId → bytes on device, for downloads scanned from IndexedDB. */
  const downloadedBytes = ref(new Map<string, number>());
  let initialized = false;

  /**
   * Best-effort device storage figures from `navigator.storage.estimate()`.
   * `quota` is the browser's cap for this origin (not the whole disk), and
   * `usage` counts everything this origin stores, not only our downloads.
   * Both are null until the first estimate resolves or when unsupported.
   */
  const storageUsage = ref<number | null>(null);
  const storageQuota = ref<number | null>(null);

  /**
   * Whether the browser has granted persistent storage for this origin.
   * When persisted, downloads survive storage-pressure and (on Safari)
   * inactivity eviction — they can only be cleared by explicit user
   * action. `null` while unknown or when the Storage API is unsupported.
   */
  const storagePersisted = ref<boolean | null>(null);
  const storagePersistenceSupported =
    typeof navigator !== "undefined" && !!navigator.storage?.persist;

  const storageAvailable = computed(() =>
    storageQuota.value != null && storageUsage.value != null
      ? Math.max(0, storageQuota.value - storageUsage.value)
      : null
  );

  /** True once we know persistence is available but not yet granted. */
  const storageAtRisk = computed(
    () => storagePersistenceSupported && storagePersisted.value === false
  );

  async function refreshStorageEstimate() {
    if (!navigator.storage?.estimate) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      storageUsage.value = usage ?? null;
      storageQuota.value = quota ?? null;
    } catch {
      // Leave the last known values in place.
    }
  }

  async function refreshPersisted() {
    if (!navigator.storage?.persisted) return;
    try {
      storagePersisted.value = await navigator.storage.persisted();
    } catch {
      // Leave the last known value in place.
    }
  }

  /**
   * Asks the browser to make this origin's storage persistent. Some
   * browsers grant it silently via heuristics, others prompt the user.
   * Returns the resulting persisted state.
   */
  async function requestPersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    try {
      const granted = await navigator.storage.persist();
      storagePersisted.value = granted;
      return granted;
    } catch {
      return false;
    }
  }

  /** User preference: browse only downloaded videos, even while online. */
  const downloadedOnly = ref(
    localStorage.getItem(DOWNLOADED_ONLY_STORAGE_KEY) === "1"
  );

  function toggleDownloadedOnly() {
    downloadedOnly.value = !downloadedOnly.value;
    try {
      localStorage.setItem(
        DOWNLOADED_ONLY_STORAGE_KEY,
        downloadedOnly.value ? "1" : "0"
      );
    } catch {
      // Preference just won't survive a reload.
    }
  }

  const downloadingCount = computed(
    () =>
      [...items.value.values()].filter(item => item.status === "downloading")
        .length
  );
  const queuedCount = computed(
    () =>
      [...items.value.values()].filter(item => item.status === "queued").length
  );
  const activeCount = computed(
    () => downloadingCount.value + queuedCount.value
  );

  function isDownloaded(videoId: string): boolean {
    return downloadedIds.value.has(videoId);
  }

  /** Bytes stored on device for a download, or null if unknown. */
  function bytesFor(videoId: string): number | null {
    return downloadedBytes.value.get(videoId) ?? null;
  }

  function itemFor(videoId: string): DownloadItem | undefined {
    return items.value.get(videoId);
  }

  function persistQueue() {
    const pending: PersistedItem[] = [...items.value.values()]
      .filter(item => item.status === "queued" || item.status === "downloading")
      .map(({ videoId, url, name }) => ({ videoId, url, name }));
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(pending));
    } catch {
      // Persistence is best-effort; the queue still works for this session.
    }
  }

  /** Starts queued downloads until the concurrency limit is reached. */
  function pump() {
    let active = downloadingCount.value;
    for (const item of items.value.values()) {
      if (active >= MAX_CONCURRENT_DOWNLOADS) break;
      if (item.status !== "queued") continue;
      item.status = "downloading";
      active += 1;
      void requestVideoDownload(item.videoId, item.url);
    }
    persistQueue();
  }

  /** Adds a video to the download queue (no-op if downloaded or already queued). */
  function enqueue(videoId: string, url: string, name: string) {
    if (downloadedIds.value.has(videoId)) return;
    const existing = items.value.get(videoId);
    if (
      existing &&
      (existing.status === "queued" || existing.status === "downloading")
    )
      return;

    items.value.set(videoId, {
      videoId,
      url,
      name,
      status: "queued",
      progress: null
    });
    pump();
  }

  /** Deletes a downloaded video from the device. */
  function deleteDownload(videoId: string) {
    items.value.delete(videoId);
    downloadedIds.value.delete(videoId);
    downloadedBytes.value.delete(videoId);
    persistQueue();
    void requestVideoDelete(videoId);
  }

  /**
   * Cancels a queued, in-progress, or failed download and purges any partial
   * bytes it left behind, then starts the next queued item. Use this rather
   * than `deleteDownload` for anything that isn't a completed download.
   */
  function cancelDownload(videoId: string) {
    items.value.delete(videoId);
    persistQueue();
    void requestVideoCancel(videoId);
    pump();
  }

  /**
   * Purges a broken download's data and re-queues a clean download for it.
   * Waits for the purge to be confirmed before re-queueing so the fresh
   * download can't read stale fileMeta left over by the corrupted one.
   */
  async function redownload(videoId: string, url: string, name: string) {
    downloadedIds.value.delete(videoId);
    items.value.delete(videoId);
    persistQueue();
    await requestVideoCancelAndWait(videoId);
    enqueue(videoId, url, name);
  }

  /** Re-queues a failed download so it resumes from its stored bytes. */
  function retry(videoId: string) {
    const item = items.value.get(videoId);
    if (!item || item.status !== "error") return;
    item.status = "queued";
    item.progress = null;
    delete item.error;
    pump();
  }

  /**
   * Removes finished (done) and failed entries from the queue list. Completed
   * downloads stay on the device; failed ones have their partial bytes purged
   * so nothing half-downloaded is left behind.
   */
  function clearFinished() {
    for (const [videoId, item] of items.value) {
      if (item.status === "done") {
        items.value.delete(videoId);
      } else if (item.status === "error") {
        items.value.delete(videoId);
        void requestVideoCancel(videoId);
      }
    }
    persistQueue();
  }

  const finishedCount = computed(
    () =>
      [...items.value.values()].filter(
        item => item.status === "done" || item.status === "error"
      ).length
  );

  function handleMessage(message: OfflineVideoMessage) {
    const item = items.value.get(message.videoId);

    switch (message.type) {
      case "download-progress":
        if (item) item.progress = message.progress;
        break;
      case "download-done":
        downloadedIds.value.add(message.videoId);
        if (item) {
          item.status = "done";
          item.progress = 1;
        }
        void refreshStorageEstimate();
        pump();
        break;
      case "download-error":
        if (item) {
          item.status = "error";
          item.error = message.message;
        }
        pump();
        break;
      case "delete-done":
        downloadedIds.value.delete(message.videoId);
        downloadedBytes.value.delete(message.videoId);
        void refreshStorageEstimate();
        break;
      case "delete-error":
        // The video may still be on disk; re-scan so the UI stays truthful.
        void refreshDownloadedIds();
        break;
      case "cancel-done":
        downloadedIds.value.delete(message.videoId);
        downloadedBytes.value.delete(message.videoId);
        void refreshStorageEstimate();
        break;
      case "cancel-error":
        // Purge may have partially failed; re-scan so the UI stays truthful.
        void refreshDownloadedIds();
        break;
    }
  }

  async function refreshDownloadedIds() {
    const videos = await getDownloadedVideos();
    downloadedIds.value = new Set(videos.map(video => video.videoId));
    downloadedBytes.value = new Map(
      videos.map(video => [video.videoId, video.bytesDownloaded])
    );
  }

  function restoreQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw) as PersistedItem[];
      for (const { videoId, url, name } of pending) {
        // Interrupted downloads resume from their last stored byte via a
        // Range request, so re-queueing after a reload is cheap.
        items.value.set(videoId, {
          videoId,
          url,
          name,
          status: "queued",
          progress: null
        });
      }
    } catch {
      // Malformed persisted state — start with an empty queue.
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;

    onDownloadMessage(handleMessage);
    void refreshStorageEstimate();
    void refreshPersisted();
    restoreQueue();
    void refreshDownloadedIds().then(() => {
      // Drop restored entries that actually finished before the reload.
      for (const videoId of downloadedIds.value) {
        const item = items.value.get(videoId);
        if (item?.status === "queued") items.value.delete(videoId);
      }
      pump();
    });

    // Downloads that failed while offline can be retried by the user, but
    // queued ones should start flowing again as soon as we're back online.
    window.addEventListener("online", pump);
  }

  return {
    items,
    downloadedIds,
    downloadedBytes,
    downloadedOnly,
    toggleDownloadedOnly,
    downloadingCount,
    queuedCount,
    activeCount,
    finishedCount,
    storageUsage,
    storageQuota,
    storageAvailable,
    storagePersisted,
    storagePersistenceSupported,
    storageAtRisk,
    refreshStorageEstimate,
    refreshPersisted,
    requestPersistence,
    isDownloaded,
    bytesFor,
    itemFor,
    enqueue,
    deleteDownload,
    cancelDownload,
    redownload,
    retry,
    clearFinished,
    refreshDownloadedIds,
    init
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDownloadsStore, import.meta.hot));
}
