import FixedBuffer from "./fixed-buffer";
import getMimeByUrl from "./get-mime-by-url";
import getIDBConnection from "./idb-connection";
import type { FileChunk, FileMeta } from "./types";

type FlushHandler = (
  fileMeta: FileMeta,
  fileChunk: FileChunk,
  isDone: boolean
) => void;

/**
 * Downloads a single video file from the network, chunking the data into
 * a `FixedBuffer` and flushing it to any attached handlers (normally a
 * `StorageManager` writing to IndexedDB).
 *
 * Unlike Kino's original, this only downloads one URL per video — no
 * adaptive-streaming manifests, since MobileMedia doesn't have those yet.
 */
export default class DownloadManager {
  private paused = false;
  private readonly buffer: FixedBuffer;
  private readonly flushHandlers: FlushHandler[] = [];
  private fileMeta: FileMeta | null = null;

  constructor(
    private readonly videoId: string,
    private readonly url: string
  ) {
    const fixedBufferSizeInBytes = 2 * 1000 * 1000; // 2 MB
    this.buffer = new FixedBuffer(fixedBufferSizeInBytes);
    this.buffer.onflush = this.bufferFlushed.bind(this);
  }

  attachFlushHandler(handler: FlushHandler): void {
    this.flushHandlers.push(handler);
  }

  pause(): void {
    this.paused = true;
  }

  /** Resolves any existing (possibly partial) download progress from IDB. */
  async prepareFileMeta(): Promise<FileMeta> {
    const db = await getIDBConnection();
    const existing = await db.file.get(this.url);

    this.fileMeta = existing ?? {
      url: this.url,
      videoId: this.videoId,
      mimeType: "application/octet-stream",
      bytesDownloaded: 0,
      bytesTotal: null,
      done: false
    };

    return this.fileMeta;
  }

  async run(): Promise<void> {
    this.paused = false;
    const fileMeta = this.fileMeta ?? (await this.prepareFileMeta());

    if (!fileMeta.done) {
      await this.downloadFile(fileMeta);
    }
  }

  private async downloadFile(fileMeta: FileMeta): Promise<void> {
    const fetchOpts: RequestInit = fileMeta.bytesDownloaded
      ? { headers: { Range: `bytes=${fileMeta.bytesDownloaded}-` } }
      : {};

    const response = await fetch(fileMeta.url, fetchOpts);
    if (!response.body) {
      throw new Error(`No response body when downloading ${fileMeta.url}`);
    }

    const reader = response.body.getReader();
    const contentRange = response.headers.get("Content-Range");
    const fileLength = contentRange
      ? Number(contentRange.split("/")[1])
      : Number(response.headers.get("Content-Length"));

    // A full (non-partial) response means the server ignored our Range
    // header, so any previously downloaded bytes need to be discarded.
    if (!contentRange) {
      fileMeta.bytesDownloaded = 0;
    }
    fileMeta.mimeType =
      response.headers.get("Content-Type") || getMimeByUrl(fileMeta.url);
    fileMeta.bytesTotal = fileLength > 0 ? fileLength : null;

    let chunk = await reader.read();
    while (!chunk.done && !this.paused) {
      this.buffer.add(chunk.value);
      // eslint-disable-next-line no-await-in-loop
      chunk = await reader.read();
    }

    this.buffer.flush(chunk.done ? { done: true } : {});
  }

  private bufferFlushed(data: Uint8Array, opts: { done?: boolean }): void {
    const fileMeta = this.fileMeta;
    if (!fileMeta) return;

    const fileChunk: FileChunk = {
      url: fileMeta.url,
      rangeStart: fileMeta.bytesDownloaded,
      rangeEnd: fileMeta.bytesDownloaded + data.length - 1,
      data
    };

    fileMeta.bytesDownloaded += data.length;
    if (opts.done) {
      fileMeta.bytesTotal = fileMeta.bytesDownloaded;
      fileMeta.done = true;
    }

    this.flushHandlers.forEach(handler =>
      handler(fileMeta, fileChunk, Boolean(opts.done))
    );
  }
}
