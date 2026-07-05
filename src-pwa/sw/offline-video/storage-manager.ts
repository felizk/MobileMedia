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

  constructor(private readonly videoId: string) {}

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Persists a downloaded chunk plus its updated file/video meta.
   *
   * When `isDone` is true, invokes `ondone` once all writes complete.
   */
  async storeChunk(
    fileMeta: FileMeta,
    fileChunk: FileChunk,
    isDone: boolean
  ): Promise<void> {
    if (this.cancelled) return;

    const db = await getIDBConnection();
    const videoMeta: VideoMeta = {
      done: isDone,
      videoId: this.videoId,
      timestamp: Date.now()
    };

    const abortHandler = (transaction: IDBTransaction) => {
      const error = transaction.error;
      if (error?.name === "QuotaExceededError") {
        this.cancel();
      }
      this.onerror(error ?? new Error("IndexedDB transaction aborted."));
    };

    const writePromise = (put: () => [IDBTransaction, IDBRequest]) =>
      new Promise<void>((resolve, reject) => {
        const [transaction, request] = put();
        transaction.onabort = () => abortHandler(transaction);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(new Error("Unable to write to offline video storage."));
      });

    await Promise.all([
      writePromise(() => db.meta.put(videoMeta)),
      writePromise(() => db.data.put(fileChunk)),
      writePromise(() => db.file.put(fileMeta))
    ]);

    this.onprogress(
      fileMeta.bytesTotal ? fileMeta.bytesDownloaded / fileMeta.bytesTotal : 0
    );

    if (isDone) {
      this.done = true;
      this.ondone();
    }
  }
}
