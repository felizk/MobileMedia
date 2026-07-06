import getIDBConnection from "./idb-connection";
import type { FileChunk, FileMeta, VideoMeta } from "./types";

/**
 * Stores video meta, data and file chunks in IndexedDB.
 *
 * Companion to `DownloadManager`, which handles the actual video data
 * download from the network — this class only handles persisting it.
 */
export default class StorageManager {
  done = false;

  onerror: (error: Error) => void = () => {};
  onprogress: (progress: number) => void = () => {};
  ondone: () => void = () => {};

  private cancelled = false;
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(private readonly videoId: string) {}

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Resolves once every write dispatched so far has settled. Callers that
   * cancel a download await this before purging the video, so no in-flight
   * write can land after the purge and resurrect partial data.
   */
  async settled(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
  }

  /**
   * Persists a downloaded chunk plus its updated file/video meta.
   *
   * When `isDone` is true, invokes `ondone` once all writes complete.
   */
  storeChunk(
    fileMeta: FileMeta,
    fileChunk: FileChunk,
    isDone: boolean
  ): Promise<void> {
    const write = this.doStoreChunk(fileMeta, fileChunk, isDone);
    this.pendingWrites.add(write);
    void write.catch(() => {}).finally(() => this.pendingWrites.delete(write));
    return write;
  }

  private async doStoreChunk(
    fileMeta: FileMeta,
    fileChunk: FileChunk,
    isDone: boolean
  ): Promise<void> {
    if (this.cancelled) return;

    // Snapshot the file meta now, before the first `await`: DownloadManager
    // keeps mutating the shared object as later chunks flush, so persisting it
    // as-is could store a byte count that belongs to a different chunk. Pin
    // `bytesDownloaded` to exactly one past this chunk's last byte so a resume
    // computes the right offset regardless of write ordering.
    const fileMetaSnapshot: FileMeta = {
      ...fileMeta,
      bytesDownloaded: fileChunk.rangeEnd + 1
    };
    const videoMeta: VideoMeta = {
      done: isDone,
      videoId: this.videoId,
      timestamp: Date.now()
    };

    const db = await getIDBConnection();

    try {
      await db.writeChunk(videoMeta, fileMetaSnapshot, fileChunk);
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        this.cancel();
      }
      this.onerror(
        error instanceof Error
          ? error
          : new Error("Unable to write to offline video storage.")
      );
      return;
    }

    this.onprogress(
      fileMetaSnapshot.bytesTotal
        ? fileMetaSnapshot.bytesDownloaded / fileMetaSnapshot.bytesTotal
        : 0
    );

    if (isDone) {
      this.done = true;
      this.ondone();
    }
  }
}
