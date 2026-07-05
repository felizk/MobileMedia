const STORAGE_KEY = "mobilemedia-playback-positions";
const WATCHED_STORAGE_KEY = "mobilemedia-watched";

/**
 * Fraction of the video that may remain unwatched while we still treat it as
 * "finished". If the user stops with less than this left, we drop the saved
 * position so the next visit starts from the beginning.
 */
const COMPLETION_THRESHOLD = 0.9;

/**
 * Don't bother remembering positions in the opening seconds — resuming a few
 * seconds in isn't worth the persisted clutter, and it lets a quick peek at an
 * episode start fresh next time.
 */
const MIN_SAVE_SECONDS = 5;

/**
 * Positions were originally stored as bare seconds; entries written since
 * recency tracking are `{ time, updatedAt }`. Readers accept both.
 */
type StoredPosition = number | { time: number; updatedAt: number };
type PositionMap = Record<string, StoredPosition>;

/** Same story for watched flags: legacy `true`, now an epoch-ms timestamp. */
type WatchedMap = Record<string, true | number>;

export interface ResumeEntry {
  path: string;
  seconds: number;
  /** Epoch ms of the last save; 0 for entries from before recency tracking. */
  updatedAt: number;
}

export interface WatchedEntry {
  path: string;
  /** Epoch ms of the last completion; 0 for entries from before tracking. */
  watchedAt: number;
}

function readMap<T extends Record<string, unknown>>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {} as T;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
}

function writeMap(key: string, map: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // Ignore quota/serialization failures — resume is a convenience, not
    // something worth surfacing to the user.
  }
}

function read(): PositionMap {
  return readMap<PositionMap>(STORAGE_KEY);
}

function write(map: PositionMap): void {
  writeMap(STORAGE_KEY, map);
}

function positionSeconds(
  stored: StoredPosition | undefined
): number | undefined {
  if (stored == null) return undefined;
  return typeof stored === "number" ? stored : stored.time;
}

/** Returns true if the video at the given path was watched to completion. */
export function isWatched(path: string): boolean {
  return path in readMap<WatchedMap>(WATCHED_STORAGE_KEY);
}

/** All videos watched to completion, most recently watched first. */
export function getWatchedEntries(): WatchedEntry[] {
  const map = readMap<WatchedMap>(WATCHED_STORAGE_KEY);
  return Object.entries(map)
    .map(([path, at]) => ({ path, watchedAt: typeof at === "number" ? at : 0 }))
    .sort((a, b) => b.watchedAt - a.watchedAt);
}

/** All in-progress resume positions, most recently updated first. */
export function getResumeEntries(): ResumeEntry[] {
  const map = readMap<PositionMap>(STORAGE_KEY);
  const entries: ResumeEntry[] = [];
  for (const [path, stored] of Object.entries(map)) {
    const seconds = positionSeconds(stored);
    if (seconds == null) continue;
    entries.push({
      path,
      seconds,
      updatedAt: typeof stored === "object" ? stored.updatedAt : 0
    });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Forgets the watched flag for the given path. */
export function clearWatched(path: string): void {
  const map = readMap<WatchedMap>(WATCHED_STORAGE_KEY);
  if (path in map) {
    delete map[path];
    writeMap(WATCHED_STORAGE_KEY, map);
  }
}

function markWatched(path: string): void {
  const map = readMap<WatchedMap>(WATCHED_STORAGE_KEY);
  // Always refresh the timestamp — a rewatch counts as recent activity.
  map[path] = Date.now();
  writeMap(WATCHED_STORAGE_KEY, map);
}

/** Returns the saved resume position in seconds, or undefined if none. */
export function getPlaybackPosition(path: string): number | undefined {
  return positionSeconds(read()[path]);
}

/** Forgets any saved position for the given path. */
export function clearPlaybackPosition(path: string): void {
  const map = read();
  if (path in map) {
    delete map[path];
    write(map);
  }
}

/**
 * Records where playback currently is. If the video is essentially finished
 * (less than 10% remaining) or barely started, the saved position is cleared
 * instead so the next visit starts from the beginning. Finishing also marks
 * the video as watched.
 */
export function savePlaybackPosition(
  path: string,
  currentTime: number,
  duration: number
): void {
  const watchedEnough =
    duration > 0 && currentTime / duration >= COMPLETION_THRESHOLD;

  if (
    watchedEnough ||
    currentTime < MIN_SAVE_SECONDS ||
    !isFinite(currentTime)
  ) {
    if (watchedEnough && isFinite(currentTime)) markWatched(path);
    clearPlaybackPosition(path);
    return;
  }

  const map = read();
  map[path] = { time: currentTime, updatedAt: Date.now() };
  write(map);
}
