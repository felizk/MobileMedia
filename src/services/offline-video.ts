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

export type OfflineVideoMessage =
  | DownloadProgressMessage
  | DownloadDoneMessage
  | DownloadErrorMessage;

/** Asks the service worker to download a video (by its stream URL) for offline playback. */
export async function requestVideoDownload(videoId: string, url: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "download-video", videoId, url });
}

/** Subscribes to download progress/done/error events from the service worker. Returns an unsubscribe function. */
export function onDownloadMessage(handler: (message: OfflineVideoMessage) => void): () => void {
  const listener = (event: MessageEvent<OfflineVideoMessage>) => handler(event.data);
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
