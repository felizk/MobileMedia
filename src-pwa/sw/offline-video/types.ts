/**
 * Metadata tracked per video, independent of the individual files
 * (video/audio/subtitle tracks) it's made of.
 */
export interface VideoMeta {
  videoId: string;
  done: boolean;
  timestamp?: number;
}

/**
 * Download/serving metadata for a single file belonging to a video,
 * keyed by its source URL.
 */
export interface FileMeta {
  url: string;
  videoId: string;
  mimeType: string;
  bytesDownloaded: number;
  bytesTotal: number | null;
  done: boolean;
}

/**
 * A downloaded byte range for a given URL, as stored in the `videoData`
 * object store.
 */
export interface FileChunk {
  url: string;
  rangeStart: number;
  rangeEnd: number;
  data: Uint8Array;
}

/**
 * Message sent from a page to the service worker to start (or resume)
 * downloading a video for offline playback.
 */
export interface DownloadVideoMessage {
  type: "download-video";
  videoId: string;
  url: string;
}

/**
 * Message sent from a page to the service worker to remove a downloaded
 * video (meta, file meta and all chunks) from offline storage.
 */
export interface DeleteVideoMessage {
  type: "delete-video";
  videoId: string;
}

export type ClientMessage = DownloadVideoMessage | DeleteVideoMessage;

export type WorkerMessage =
  | { type: "download-progress"; videoId: string; progress: number }
  | { type: "download-done"; videoId: string }
  | { type: "download-error"; videoId: string; message: string }
  | { type: "delete-done"; videoId: string }
  | { type: "delete-error"; videoId: string; message: string };
