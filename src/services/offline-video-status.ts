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
  if (!databases.some((db) => db.name === DB_NAME)) return null;

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Returns the subset of the given URLs that have been fully downloaded for offline playback. */
export async function getDownloadedUrls(urls: string[]): Promise<Set<string>> {
  const downloaded = new Set<string>();
  if (urls.length === 0) return downloaded;

  const db = await openIfExists();
  if (!db) return downloaded;

  if (!db.objectStoreNames.contains(FILE_META_STORE)) {
    db.close();
    return downloaded;
  }

  const store = db.transaction([FILE_META_STORE], "readonly").objectStore(FILE_META_STORE);

  await Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const request = store.get(url);
          request.onsuccess = () => {
            const fileMeta = request.result as { done?: boolean } | undefined;
            if (fileMeta?.done) downloaded.add(url);
            resolve();
          };
          request.onerror = () => resolve();
        })
    )
  );

  db.close();
  return downloaded;
}
