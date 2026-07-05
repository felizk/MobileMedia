const STORAGE_KEY = "mobilemedia-playback-positions";

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

type PositionMap = Record<string, number>;

function read(): PositionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as PositionMap)
      : {};
  } catch {
    return {};
  }
}

function write(map: PositionMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota/serialization failures — resume is a convenience, not
    // something worth surfacing to the user.
  }
}

/** Returns the saved resume position in seconds, or undefined if none. */
export function getPlaybackPosition(path: string): number | undefined {
  return read()[path];
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
 * instead so the next visit starts from the beginning.
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
    clearPlaybackPosition(path);
    return;
  }

  const map = read();
  map[path] = currentTime;
  write(map);
}
