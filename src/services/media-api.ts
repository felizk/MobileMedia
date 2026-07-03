const API_BASE = "https://mmbe.felizk.net/api/media";

export interface MediaDirectoryEntry {
  name: string;
  path: string;
}

export interface MediaFileEntry {
  name: string;
  path: string;
  sizeBytes: number;
  extension: string;
}

export interface BrowseResult {
  path: string;
  directories: MediaDirectoryEntry[];
  files: MediaFileEntry[];
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export async function browseMedia(path: string): Promise<BrowseResult> {
  const response = await fetch(`${API_BASE}/browse/${encodePathSegments(path)}`);
  if (!response.ok) {
    throw new Error(`Failed to browse "${path || "/"}" (${response.status}).`);
  }
  return response.json() as Promise<BrowseResult>;
}

export function getStreamUrl(path: string): string {
  return `${API_BASE}/stream/${encodePathSegments(path)}`;
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
