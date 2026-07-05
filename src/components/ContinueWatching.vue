<template>
  <div v-if="cards.length" class="q-mb-md">
    <div class="text-subtitle1 q-mb-sm">Continue watching</div>
    <q-list bordered separator>
      <q-item
        v-for="card in cards"
        :key="card.path"
        clickable
        :to="toWatchPath(card.path)"
      >
        <q-item-section avatar>
          <q-icon
            :name="card.kind === 'resume' ? 'play_circle' : 'skip_next'"
            color="secondary"
          />
        </q-item-section>
        <q-item-section>
          <q-item-label lines="1">{{ card.name }}</q-item-label>
          <q-item-label caption lines="1">{{ captionOf(card) }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  browseMedia,
  toWatchPath,
  type MediaFileEntry
} from "@/services/media-api";
import {
  getResumeEntries,
  getWatchedEntries,
  type ResumeEntry,
  type WatchedEntry
} from "@/services/playback-position";
import { useDownloadsStore } from "@/stores/downloads";

/** How many shows to surface. */
const MAX_CARDS = 5;
/**
 * How many recently-active folders to consider. More than MAX_CARDS so a
 * finished show (no next episode) or an unavailable file doesn't leave a
 * hole in the list.
 */
const MAX_FOLDERS = 10;

interface Card {
  /** Source path of the episode to play. */
  path: string;
  name: string;
  folder: string;
  kind: "resume" | "next";
  /** Only for `resume` cards. */
  resumeSeconds?: number;
}

/** A folder's most recent in-progress and completed episodes. */
interface FolderActivity {
  folder: string;
  resume?: ResumeEntry;
  lastWatched?: WatchedEntry;
  /** Most recent activity of either kind, for ranking folders. */
  at: number;
}

const downloads = useDownloadsStore();
const cards = ref<Card[]>([]);

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function nameOf(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/**
 * True when the folder's latest activity was finishing an episode, so the
 * card should point at the following episode rather than resume one.
 */
function wantsNext(activity: FolderActivity): boolean {
  if (!activity.lastWatched) return false;
  if (!activity.resume) return true;
  return activity.lastWatched.watchedAt > activity.resume.updatedAt;
}

function isPlayable(file: MediaFileEntry, offline: boolean): boolean {
  return (
    downloads.isDownloaded(file.path) ||
    (!offline && file.encodeStatus === "Encoded")
  );
}

function resumeCard(
  activity: FolderActivity,
  offline: boolean
): Card | undefined {
  const entry = activity.resume;
  if (!entry) return undefined;
  if (offline && !downloads.isDownloaded(entry.path)) return undefined;
  return {
    path: entry.path,
    name: nameOf(entry.path),
    folder: activity.folder,
    kind: "resume",
    resumeSeconds: entry.seconds
  };
}

/**
 * The first not-yet-watched file after the last watched one, in natural sort
 * order. Deliberately gives up (rather than skipping ahead) when that file
 * isn't playable, so we never suggest jumping over an episode.
 */
function nextCard(
  activity: FolderActivity,
  files: MediaFileEntry[] | undefined,
  watched: Set<string>,
  offline: boolean
): Card | undefined {
  const last = activity.lastWatched;
  if (!last || !files) return undefined;
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  const lastIndex = sorted.findIndex(file => file.path === last.path);
  if (lastIndex < 0) return undefined;
  for (let i = lastIndex + 1; i < sorted.length; i++) {
    const file = sorted[i];
    if (!file || watched.has(file.path)) continue;
    if (!isPlayable(file, offline)) return undefined;
    return {
      path: file.path,
      name: file.name,
      folder: activity.folder,
      kind: "next"
    };
  }
  return undefined;
}

async function load() {
  const offline = !navigator.onLine;
  const resumeEntries = getResumeEntries();
  const watchedEntries = getWatchedEntries();
  const watchedSet = new Set(watchedEntries.map(entry => entry.path));

  const byFolder = new Map<string, FolderActivity>();
  const activityFor = (folder: string): FolderActivity => {
    let activity = byFolder.get(folder);
    if (!activity) {
      activity = { folder, at: 0 };
      byFolder.set(folder, activity);
    }
    return activity;
  };
  // Both lists are sorted newest-first, so the first entry seen per folder
  // is that folder's most recent of its kind.
  for (const entry of resumeEntries) {
    const activity = activityFor(folderOf(entry.path));
    activity.resume ??= entry;
    activity.at = Math.max(activity.at, entry.updatedAt);
  }
  for (const entry of watchedEntries) {
    const activity = activityFor(folderOf(entry.path));
    activity.lastWatched ??= entry;
    activity.at = Math.max(activity.at, entry.watchedAt);
  }

  const candidates = [...byFolder.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_FOLDERS);

  // "Next episode" cards need the folder listing; fetch those in parallel.
  // Failures (offline and never cached, folder deleted…) just drop the card.
  const listings = new Map<string, MediaFileEntry[]>();
  await Promise.all(
    candidates.filter(wantsNext).map(async candidate => {
      try {
        const result = await browseMedia(candidate.folder);
        listings.set(candidate.folder, result.files);
      } catch {
        // Skip this folder.
      }
    })
  );

  const resolved: Card[] = [];
  for (const candidate of candidates) {
    if (resolved.length >= MAX_CARDS) break;
    const card = wantsNext(candidate)
      ? nextCard(candidate, listings.get(candidate.folder), watchedSet, offline)
      : resumeCard(candidate, offline);
    if (card) resolved.push(card);
  }
  cards.value = resolved;
}

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function captionOf(card: Card): string {
  const folderLabel = card.folder ? card.folder.split("/").join(" › ") : "Home";
  const action =
    card.kind === "resume" && card.resumeSeconds != null
      ? `Resume at ${formatTime(card.resumeSeconds)}`
      : "Next episode";
  return `${folderLabel} · ${action}`;
}

onMounted(() => void load());
</script>
