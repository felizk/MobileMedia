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

export type OfflineVideoMessage =
  | DownloadProgressMessage
  | DownloadDoneMessage
  | DownloadErrorMessage
  | DeleteDoneMessage
  | DeleteErrorMessage;

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

/** Subscribes to download progress/done/error events from the service worker. Returns an unsubscribe function. */
export function onDownloadMessage(
  handler: (message: OfflineVideoMessage) => void
): () => void {
  const listener = (event: MessageEvent<OfflineVideoMessage>) =>
    handler(event.data);
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
