export const DB_NAME = "mobilemedia-offline-video";
export const DB_VERSION = 1;

export const STORAGE_SCHEMA = {
  meta: {
    name: "videoMeta",
    key: "videoId"
  },
  data: {
    name: "videoData"
  },
  filemeta: {
    name: "fileMeta",
    key: "url"
  }
} as const;

/** IDB index name used to access individual stored video chunks. */
export const IDB_CHUNK_INDEX = "video-chunk";
