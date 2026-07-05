const DB_NAME = "mobilemedia-offline-video";
const FILE_META_STORE = "fileMeta";

/**
 * Opens the offline-video database read-only, WITHOUT specifying a version.
 *
 * The service worker owns schema creation. If we called `indexedDB.open`
 * with a version here and the database didn't exist yet, we'd create an
 * empty stub at that version — which would then stop the service worker's
 * own `onupgradeneeded` from ever firing. So we only open a database that's
 * already known to exist, and treat anything else as "nothing downloaded".
 */
async function openIfExists(): Promise<IDBDatabase | null> {
  if (!("databases" in indexedDB)) return null;

  const databases = await indexedDB.databases();
  if (!databases.some(db => db.name === DB_NAME)) return null;

  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export interface DownloadedVideo {
  /** The source-tree file path used as the download's identifier. */
  videoId: string;
  /** The stream URL the bytes were fetched from. */
  url: string;
}

/** Returns every video that has been fully downloaded for offline playback. */
export async function getDownloadedVideos(): Promise<DownloadedVideo[]> {
  const db = await openIfExists();
  if (!db) return [];

  if (!db.objectStoreNames.contains(FILE_META_STORE)) {
    db.close();
    return [];
  }

  const store = db
    .transaction([FILE_META_STORE], "readonly")
    .objectStore(FILE_META_STORE);

  const downloaded = await new Promise<DownloadedVideo[]>(resolve => {
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result as {
        videoId: string;
        url: string;
        done?: boolean;
      }[];
      resolve(
        entries
          .filter(entry => entry.done)
          .map(entry => ({ videoId: entry.videoId, url: entry.url }))
      );
    };
    request.onerror = () => resolve([]);
  });

  db.close();
  return downloaded;
}
