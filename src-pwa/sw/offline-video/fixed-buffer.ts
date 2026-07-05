interface FlushOptions {
  done?: boolean;
}

/**
 * Fixed size buffer that flushes and resets its internal pointer
 * when it would overflow.
 */
export default class FixedBuffer {
  private readonly uint8: Uint8Array;
  private readonly arrayBuffer: ArrayBufferLike;
  private readonly size: number;
  private pointerPosition = 0;

  onflush: ((data: Uint8Array, opts: FlushOptions) => void) | null = null;

  constructor(sizeInBytes: number) {
    this.size = sizeInBytes;
    this.uint8 = new Uint8Array(sizeInBytes);
    this.arrayBuffer = this.uint8.buffer;
  }

  get bytesLeft(): number {
    return this.size - this.pointerPosition;
  }

  add(data: Uint8Array): void {
    let offset = 0;

    while (offset < data.length) {
      const chunkLength = this.bytesLeft;
      const dataChunk = this.crop(data, offset, chunkLength);

      this.uint8.set(dataChunk, this.pointerPosition);
      this.pointerPosition += dataChunk.length;

      if (this.pointerPosition === this.size) {
        this.flush();
      }
      offset += chunkLength;
    }
  }

  /** Returns a buffer view over `data` starting at `offset`, capped at `availableLength`. */
  private crop(
    data: Uint8Array,
    offset: number,
    availableLength: number
  ): Uint8Array {
    const length = Math.min(availableLength, data.length - offset);
    return new Uint8Array(data.buffer, offset, length);
  }

  /** Resets the pointer position and calls `onflush` with the currently buffered data. */
  flush(opts: FlushOptions = {}): void {
    const data = new Uint8Array(this.arrayBuffer, 0, this.pointerPosition);

    // Clone before handing off — `onflush` handlers write to IDB asynchronously,
    // and the buffer's underlying storage is reused by the next add() right after this.
    const clonedData = this.cloneBuffer(data);

    this.onflush?.(clonedData, opts);
    this.pointerPosition = 0;
  }

  private cloneBuffer(source: Uint8Array): Uint8Array {
    const clone = new Uint8Array(source.length);
    clone.set(source);
    return clone;
  }
}
