export interface DownloadProgressMessage {
  type: "download-progress";
  videoId: string;
  progress: number;
}

export interface DownloadDoneMessage {
  type: "download-done";
  videoId: string;
}

export interface DownloadErrorMessage {
  type: "download-error";
  videoId: string;
  message: string;
}

export interface DeleteDoneMessage {
  type: "delete-done";
  videoId: string;
}

export interface DeleteErrorMessage {
  type: "delete-error";
  videoId: string;
  message: string;
}

export interface CancelDoneMessage {
  type: "cancel-done";
  videoId: string;
}

export interface CancelErrorMessage {
  type: "cancel-error";
  videoId: string;
  message: string;
}

export type OfflineVideoMessage =
  | DownloadProgressMessage
  | DownloadDoneMessage
  | DownloadErrorMessage
  | DeleteDoneMessage
  | DeleteErrorMessage
  | CancelDoneMessage
  | CancelErrorMessage;

/** Asks the service worker to download a video (by its stream URL) for offline playback. */
export async function requestVideoDownload(
  videoId: string,
  url: string
): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "download-video", videoId, url });
}

/** Asks the service worker to delete a downloaded video from offline storage. */
export async function requestVideoDelete(videoId: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "delete-video", videoId });
}

/**
 * Asks the service worker to cancel an in-progress (or previously failed)
 * download and purge any partial bytes it left behind.
 */
export async function requestVideoCancel(videoId: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "cancel-video", videoId });
}

/**
 * Same as `requestVideoCancel`, but resolves only once the service worker
 * confirms the purge finished. A redownload started right after this is
 * guaranteed not to read stale fileMeta left over by the purged one.
 */
export async function requestVideoCancelAndWait(
  videoId: string
): Promise<void> {
  const registration = await navigator.serviceWorker.ready;

  await new Promise<void>((resolve, reject) => {
    const listener = (event: MessageEvent<OfflineVideoMessage>) => {
      const message = event.data;
      if (message.videoId !== videoId) return;
      if (message.type === "cancel-done") {
        navigator.serviceWorker.removeEventListener("message", listener);
        resolve();
      } else if (message.type === "cancel-error") {
        navigator.serviceWorker.removeEventListener("message", listener);
        reject(new Error(message.message));
      }
    };
    navigator.serviceWorker.addEventListener("message", listener);
    registration.active?.postMessage({ type: "cancel-video", videoId });
  });
}

/** Subscribes to download progress/done/error events from the service worker. Returns an unsubscribe function. */
export function onDownloadMessage(
  handler: (message: OfflineVideoMessage) => void
): () => void {
  const listener = (event: MessageEvent<OfflineVideoMessage>) =>
    handler(event.data);
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
