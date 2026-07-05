export const API_ORIGIN = "https://mmbe.felizk.net";

const API_BASE = `${API_ORIGIN}/api/media`;

export interface MediaDirectoryEntry {
  name: string;
  path: string;
}

/**
 * Whether the corresponding encoded `.mp4` exists in the media library.
 * Optional because listings cached before this field existed may lack it.
 */
export type EncodeStatus = "Encoded" | "Encoding" | "NotEncoded";

export interface MediaFileEntry {
  name: string;
  path: string;
  sizeBytes: number;
  extension: string;
  encodeStatus?: EncodeStatus;
}

export interface BrowseResult {
  path: string;
  directories: MediaDirectoryEntry[];
  files: MediaFileEntry[];
}

function encodePathSegments(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export async function browseMedia(path: string): Promise<BrowseResult> {
  const response = await fetch(
    `${API_BASE}/browse/${encodePathSegments(path)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to browse "${path || "/"}" (${response.status}).`);
  }
  return response.json() as Promise<BrowseResult>;
}

/**
 * Maps a source-tree file path to its media-tree (encoded) counterpart:
 * same relative path with the extension changed to `.mp4`.
 */
export function toMediaPath(path: string): string {
  return path.replace(/\.[^./]+$/, ".mp4");
}

/** Stream URL for a *source* file path — resolves to its encoded `.mp4`. */
export function getStreamUrl(path: string): string {
  return `${API_BASE}/stream/${encodePathSegments(toMediaPath(path))}`;
}

/** App-relative route path for browsing a directory. */
export function toBrowsePath(path: string): string {
  const encoded = encodePathSegments(path);
  return encoded ? `/browse/${encoded}` : "/";
}

/** App-relative route path for watching a file. */
export function toWatchPath(path: string): string {
  return `/watch/${encodePathSegments(path)}`;
}
