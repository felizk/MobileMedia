import {
  DB_NAME,
  DB_VERSION,
  STORAGE_SCHEMA,
  IDB_CHUNK_INDEX
} from "./constants";
import type { VideoMeta, FileMeta, FileChunk } from "./types";

interface DefaultAccessor {
  put(data: unknown, storeName: string): [IDBTransaction, IDBRequest];
}

class MetaAccessor {
  readonly name = STORAGE_SCHEMA.meta.name;

  constructor(
    private readonly db: IDBDatabase,
    private readonly defaultAccessor: DefaultAccessor
  ) {}

  async get(videoId: string): Promise<VideoMeta> {
    const defaultValue: VideoMeta = { videoId, done: false };
    const transaction = this.db.transaction([this.name], "readonly");
    const store = transaction.objectStore(this.name);

    return new Promise((resolve, reject) => {
      const request = store.get(videoId);
      request.onsuccess = () =>
        resolve((request.result as VideoMeta | undefined) ?? defaultValue);
      request.onerror = () =>
        reject(
          new Error(`Unable to fetch meta information for video: ${videoId}`)
        );
    });
  }

  async getAll(): Promise<VideoMeta[]> {
    const transaction = this.db.transaction([this.name], "readonly");
    const store = transaction.objectStore(this.name);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = (request.result as VideoMeta[]).sort((a, b) =>
          (a.timestamp ?? 0) < (b.timestamp ?? 0) ? 1 : -1
        );
        resolve(entries);
      };
      request.onerror = () =>
        reject(new Error("Unable to fetch meta information."));
    });
  }

  put(videoMetaData: VideoMeta): [IDBTransaction, IDBRequest] {
    return this.defaultAccessor.put(videoMetaData, this.name);
  }
}

class DataAccessor {
  readonly name = STORAGE_SCHEMA.data.name;

  constructor(private readonly defaultAccessor: DefaultAccessor) {}

  put(videoData: FileChunk): [IDBTransaction, IDBRequest] {
    return this.defaultAccessor.put(videoData, this.name);
  }
}

class FileAccessor {
  readonly name = STORAGE_SCHEMA.filemeta.name;

  constructor(
    private readonly db: IDBDatabase,
    private readonly defaultAccessor: DefaultAccessor
  ) {}

  async get(url: string): Promise<FileMeta | undefined> {
    const transaction = this.db.transaction([this.name], "readonly");
    const store = transaction.objectStore(this.name);

    return new Promise(resolve => {
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result as FileMeta | undefined);
      request.onerror = () => resolve(undefined);
    });
  }

  async getByVideoId(videoId: string): Promise<FileMeta[]> {
    const transaction = this.db.transaction([this.name], "readonly");
    const store = transaction.objectStore(this.name);
    const idIndex = store.index("videoId");
    const keyRange = IDBKeyRange.only(videoId);

    return new Promise(resolve => {
      const fileMeta: FileMeta[] = [];
      const request = idIndex.openCursor(keyRange);

      request.onsuccess = e => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>)
          .result;
        if (cursor) {
          fileMeta.push(cursor.value as FileMeta);
          cursor.continue();
        } else {
          resolve(fileMeta);
        }
      };
      request.onerror = () => resolve([]);
    });
  }

  put(fileMeta: FileMeta): [IDBTransaction, IDBRequest] {
    return this.defaultAccessor.put(fileMeta, this.name);
  }
}

export class IDBConnection {
  readonly meta: MetaAccessor;
  readonly data: DataAccessor;
  readonly file: FileAccessor;

  private readonly defaultAccessor: DefaultAccessor;

  constructor(private readonly db: IDBDatabase) {
    this.defaultAccessor = {
      put: (data, storeName) => {
        const transaction = this.db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        return [transaction, store.put(data)];
      }
    };

    this.meta = new MetaAccessor(db, this.defaultAccessor);
    this.data = new DataAccessor(this.defaultAccessor);
    this.file = new FileAccessor(db, this.defaultAccessor);
  }

  unwrap(): IDBDatabase {
    return this.db;
  }

  /**
   * Persists one downloaded chunk together with its file/video meta in a
   * single transaction, so the stored byte count can never drift out of sync
   * with the chunk data that actually landed (a resume derives its offset
   * from `bytesDownloaded`, so a mismatch means gaps or re-written ranges).
   *
   * The write is idempotent: a chunk whose exact `[url, rangeStart, rangeEnd]`
   * range is already stored replaces the existing one instead of tripping the
   * unique index. A resume, or a redownload over bytes left behind by a failed
   * attempt, can legitimately re-store a range — treating that as a fatal
   * `ConstraintError` is what left downloads with a gap yet marked done, or
   * surfaced as the "uniqueness constraint" error on redownload.
   */
  writeChunk(
    videoMeta: VideoMeta,
    fileMeta: FileMeta,
    fileChunk: FileChunk
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [this.meta.name, this.data.name, this.file.name],
        "readwrite"
      );
      const dataStore = transaction.objectStore(this.data.name);
      const chunkIndex = dataStore.index(IDB_CHUNK_INDEX);

      // Replace any chunk already stored for this exact range, then add the new
      // one — both in this transaction, delete before put, so the unique index
      // never sees two records for the same range.
      const keyRequest = chunkIndex.getKey([
        fileChunk.url,
        fileChunk.rangeStart,
        fileChunk.rangeEnd
      ]);
      keyRequest.onsuccess = () => {
        if (keyRequest.result !== undefined) {
          dataStore.delete(keyRequest.result);
        }
        dataStore.put(fileChunk);
      };

      transaction.objectStore(this.meta.name).put(videoMeta);
      transaction.objectStore(this.file.name).put(fileMeta);

      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("Offline video storage transaction aborted.")
        );
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("Unable to write to offline video storage.")
        );
    });
  }

  /** Removes all entries from the database used for video storage. */
  clearAll(): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [this.meta.name, this.data.name, this.file.name],
        "readwrite"
      );

      transaction.objectStore(this.meta.name).clear();
      transaction.objectStore(this.data.name).clear();
      transaction.objectStore(this.file.name).clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new Error("Unable to clear offline video storage."));
    });
  }

  /** Removes a single video (and its file chunks) from the database by ID. */
  removeVideo(id: string, files: FileMeta[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [this.meta.name, this.data.name, this.file.name],
        "readwrite"
      );
      const metaStore = transaction.objectStore(this.meta.name);
      const dataStore = transaction.objectStore(this.data.name);
      const fileStore = transaction.objectStore(this.file.name);
      const dataUrlIndex = dataStore.index(IDB_CHUNK_INDEX);

      const removeFileChunks = (file: FileMeta) => {
        const range = IDBKeyRange.bound(
          [file.url, -Infinity, -Infinity],
          [file.url, Infinity, Infinity]
        );
        const cursorRequest = dataUrlIndex.openKeyCursor(range);

        cursorRequest.onsuccess = e => {
          const cursor = (e.target as IDBRequest<IDBCursor | null>).result;
          if (cursor) {
            dataStore.delete(cursor.primaryKey);
            cursor.continue();
          }
        };
      };

      files.forEach(file => {
        fileStore.delete(file.url);
        removeFileChunks(file);
      });
      metaStore.delete(id);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new Error(`Unable to remove video: ${id}`));
    });
  }
}

let connection: Promise<IDBConnection> | null = null;

/** Provides access to video data stored in IDB, opening the connection on first use. */
export default function getIDBConnection(): Promise<IDBConnection> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    const dbRequest = indexedDB.open(DB_NAME, DB_VERSION);

    dbRequest.onsuccess = () => resolve(new IDBConnection(dbRequest.result));
    dbRequest.onerror = () =>
      reject(new Error("Unable to open offline video database."));

    dbRequest.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;

      db.createObjectStore(STORAGE_SCHEMA.meta.name, {
        keyPath: STORAGE_SCHEMA.meta.key
      });

      const dataStore = db.createObjectStore(STORAGE_SCHEMA.data.name, {
        autoIncrement: true
      });
      dataStore.createIndex(
        IDB_CHUNK_INDEX,
        ["url", "rangeStart", "rangeEnd"],
        { unique: true }
      );

      const fileStore = db.createObjectStore(STORAGE_SCHEMA.filemeta.name, {
        keyPath: STORAGE_SCHEMA.filemeta.key
      });
      fileStore.createIndex("videoId", "videoId");
    };
  });

  return connection;
}
