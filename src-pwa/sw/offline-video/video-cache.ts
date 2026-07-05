import getIDBConnection, { type IDBConnection } from "./idb-connection";
import { STORAGE_SCHEMA, IDB_CHUNK_INDEX } from "./constants";
import type { FileChunk, FileMeta } from "./types";

/**
 * Builds a `Range`-aware streamed `Response` for a fully downloaded video,
 * reading its chunks back out of IndexedDB in reverse-cursor order.
 */
function getResponseStream(
  request: Request,
  db: IDBConnection,
  fileMeta: FileMeta
): Response {
  const rangeHeader = request.headers.get("range") ?? "";
  const byteRanges = rangeHeader.match(/bytes=(?<from>[0-9]+)?-(?<to>[0-9]+)?/);
  const bytesTotal = fileMeta.bytesTotal ?? fileMeta.bytesDownloaded;
  const rangeFrom = Number(byteRanges?.groups?.["from"] ?? 0);
  const rangeTo = Number(byteRanges?.groups?.["to"] ?? bytesTotal - 1);

  let currentBytePointer = rangeFrom;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const rawIDB = db.unwrap();
      const transaction = rawIDB.transaction(
        STORAGE_SCHEMA.data.name,
        "readonly"
      );
      const store = transaction.objectStore(STORAGE_SCHEMA.data.name);

      // All entries for this URL whose rangeStart is <= currentBytePointer,
      // walked in reverse so the first cursor hit is the chunk we want next.
      const allEntriesForUrlRange = IDBKeyRange.bound(
        [request.url, -Infinity, -Infinity],
        [request.url, currentBytePointer, Infinity]
      );

      const index = store.index(IDB_CHUNK_INDEX);
      const cursorRequest = index.openCursor(allEntriesForUrlRange, "prev");

      return new Promise<void>(resolve => {
        cursorRequest.onerror = () => {
          controller.close();
          resolve();
        };
        cursorRequest.onsuccess = e => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>)
            .result;

          if (cursor) {
            const dataChunk = cursor.value as FileChunk;
            const needsSlice =
              dataChunk.rangeStart < rangeFrom || dataChunk.rangeEnd > rangeTo;
            const outOfBounds = dataChunk.rangeEnd < currentBytePointer;

            if (outOfBounds) {
              controller.close();
            } else if (!needsSlice) {
              controller.enqueue(dataChunk.data);
              currentBytePointer += dataChunk.data.length;
            } else {
              const sliceFrom = Math.max(0, rangeFrom - dataChunk.rangeStart);
              const sliceTo = Math.min(
                dataChunk.rangeEnd - dataChunk.rangeStart + 1,
                rangeTo - dataChunk.rangeStart + 1
              );
              const bufferSlice = new Uint8Array(
                dataChunk.data.slice(sliceFrom, sliceTo)
              );
              controller.enqueue(bufferSlice);
              currentBytePointer += bufferSlice.length;
            }
          } else {
            controller.close();
          }

          resolve();
        };
      });
    }
  });

  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": fileMeta.mimeType || "application/octet-stream",
    "Content-Length": String(rangeTo - rangeFrom + 1)
  };
  if (rangeHeader) {
    headers["Content-Range"] = `bytes ${rangeFrom}-${rangeTo}/${bytesTotal}`;
  }

  return new Response(stream, {
    status: rangeHeader ? 206 : 200,
    statusText: rangeHeader ? "Partial Content" : "OK",
    headers
  });
}

/**
 * If `request` is for a video/audio file that's been fully downloaded for
 * offline playback, returns a `Response` serving it from IndexedDB.
 * Returns `null` if nothing cached is found, so the caller can fall back
 * to a normal network fetch.
 */
export default async function getVideoCacheResponse(
  request: Request
): Promise<Response | null> {
  const db = await getIDBConnection();
  const fileMeta = await db.file.get(request.url);

  if (fileMeta?.done) {
    return getResponseStream(request, db, fileMeta);
  }
  return null;
}
