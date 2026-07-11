<template>
  <q-page class="q-pa-md">
    <!-- Extra content above the browser, e.g. Continue Watching on Home. -->
    <slot />

    <div class="row items-center q-mb-md">
      <q-breadcrumbs class="col">
        <q-breadcrumbs-el label="Home" icon="home" to="/" />
        <q-breadcrumbs-el
          v-for="crumb in breadcrumbs"
          :key="crumb.path"
          :label="crumb.name"
          :to="toBrowsePath(crumb.path)"
        />
      </q-breadcrumbs>

      <q-btn
        v-if="!isOffline && encodableCount > 0"
        dense
        no-caps
        color="primary"
        icon="bolt"
        :label="`Encode all (${encodableCount})`"
        :loading="encodingAll"
        class="q-mr-sm"
        @click="encodeAll"
      />

      <q-btn
        flat
        round
        dense
        icon="offline_pin"
        :color="downloads.downloadedOnly ? 'positive' : 'grey'"
        :disable="isOffline"
        aria-label="Show downloaded only"
        @click="downloads.toggleDownloadedOnly"
      >
        <q-tooltip>{{
          downloads.downloadedOnly
            ? "Showing encoded & downloaded only — tap to show everything"
            : "Show encoded & downloaded only"
        }}</q-tooltip>
      </q-btn>
    </div>

    <q-banner v-if="isOffline" class="bg-warning text-white q-mb-md" rounded>
      You're offline — showing only videos downloaded to this device.
    </q-banner>

    <!-- Error/loading only take over the whole view when there's nothing on
         device to show; downloaded content in this folder always renders. -->
    <q-banner
      v-if="error && isEmpty"
      class="bg-negative text-white q-mb-md"
      rounded
    >
      {{ error }}
    </q-banner>

    <q-linear-progress
      v-else-if="loading && isEmpty"
      indeterminate
      color="primary"
      class="q-mb-md"
    />

    <q-list v-else bordered separator>
      <q-item
        v-for="dir in visibleDirectories"
        :key="dir.path"
        clickable
        :to="toBrowsePath(dir.path)"
      >
        <q-item-section avatar>
          <q-icon name="folder" color="primary" />
        </q-item-section>
        <q-item-section>{{ dir.name }}</q-item-section>
      </q-item>

      <q-item
        v-for="file in visibleFiles"
        :key="file.path"
        :clickable="isPlayable(file)"
        :to="isPlayable(file) ? toWatchPath(file.path) : undefined"
      >
        <q-item-section avatar>
          <q-icon
            name="movie"
            :color="isPlayable(file) ? 'secondary' : 'grey-5'"
          />
        </q-item-section>

        <q-item-section>
          <q-item-label :class="{ 'text-grey-6': !isPlayable(file) }">{{
            file.name
          }}</q-item-label>
          <q-item-label caption>{{ fileCaption(file) }}</q-item-label>
        </q-item-section>

        <q-item-section side>
          <div class="row items-center q-gutter-xs no-wrap">
            <!-- Encode state -->
            <template v-if="statusOf(file) === 'Encoding'">
              <q-badge color="orange" outline>{{
                encodingLabel(file)
              }}</q-badge>
            </template>
            <q-btn
              v-else-if="statusOf(file) === 'NotEncoded' && !isOffline"
              dense
              no-caps
              outline
              color="primary"
              icon="bolt"
              label="Encode"
              :loading="pendingEncodes.has(file.path)"
              @click.stop.prevent="encodeFile(file)"
            />

            <!-- Download state -->
            <template v-if="isDownloaded(file)">
              <q-icon name="offline_pin" color="positive" size="24px">
                <q-tooltip>Downloaded for offline</q-tooltip>
              </q-icon>
              <q-btn
                dense
                round
                flat
                icon="delete"
                color="negative"
                aria-label="Delete download"
                @click.stop.prevent="deleteFile(file)"
              >
                <q-tooltip>Delete from device</q-tooltip>
              </q-btn>
            </template>
            <DownloadControl
              v-else
              :video-id="file.path"
              :url="getStreamUrl(file.path)"
              :name="file.name"
              :can-download="statusOf(file) === 'Encoded' && !isOffline"
            />
          </div>
        </q-item-section>
      </q-item>

      <q-item v-if="isEmpty">
        <q-item-section class="text-grey">
          {{
            isOffline
              ? "Nothing downloaded in this folder."
              : downloads.downloadedOnly
                ? "Nothing encoded or downloaded in this folder."
                : "This folder is empty."
          }}
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script lang="ts">
import type { BrowseResult } from "@/services/media-api";

// Session-wide listing cache, shared across MediaBrowser instances, so
// returning to a folder renders instantly instead of collapsing into a
// loading bar (which would defeat the router's scroll restoration).
const browseCache = new Map<string, BrowseResult>();
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  browseMedia,
  getStreamUrl,
  toBrowsePath,
  toWatchPath,
  type EncodeStatus,
  type MediaDirectoryEntry,
  type MediaFileEntry
} from "@/services/media-api";
import { useDownloadsStore, type DownloadItem } from "@/stores/downloads";
import { useEncodesStore } from "@/stores/encodes";
import { formatBytes } from "@/utils/format-bytes";
import DownloadControl from "./DownloadControl.vue";

const props = defineProps<{ path: string }>();

const downloads = useDownloadsStore();
const encodes = useEncodesStore();

const result = ref<BrowseResult | null>(null);
const loading = ref(true);
const error = ref("");
const pendingEncodes = ref(new Set<string>());
const encodingAll = ref(false);

const isOffline = ref(!navigator.onLine);
const updateOnlineStatus = () => {
  isOffline.value = !navigator.onLine;
};
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
onUnmounted(() => {
  window.removeEventListener("online", updateOnlineStatus);
  window.removeEventListener("offline", updateOnlineStatus);
});

const breadcrumbs = computed(() => {
  const segments = props.path.split("/").filter(Boolean);
  let cumulative = "";
  return segments.map(name => {
    cumulative = cumulative ? `${cumulative}/${name}` : name;
    return { name, path: cumulative };
  });
});

/**
 * The listing's `encodeStatus` overlaid with live queue state, so a file
 * flips to "Encoding" the moment it's queued and to "Encoded" the moment
 * its job completes — without re-fetching the directory.
 */
function statusOf(file: MediaFileEntry): EncodeStatus {
  const job = encodes.jobBySourcePath.get(file.path);

  if (job) {
    if (job.status === "Completed") return "Encoded";
    if (job.status === "Queued" || job.status === "Running") return "Encoding";
    // Failed/Canceled: the listing's "Encoding" (if any) referred to this
    // same job, so only trust a static "Encoded".
    return file.encodeStatus === "Encoded" ? "Encoded" : "NotEncoded";
  }
  return file.encodeStatus ?? "NotEncoded";
}

function isDownloaded(file: MediaFileEntry): boolean {
  return downloads.isDownloaded(file.path);
}

function downloadItemOf(file: MediaFileEntry): DownloadItem | undefined {
  return downloads.itemFor(file.path);
}

function isPlayable(file: MediaFileEntry): boolean {
  return (
    isDownloaded(file) || (!isOffline.value && statusOf(file) === "Encoded")
  );
}

// With the toggle on while online, the server does the filtering
// (?encodedOnly=true → encoded files plus folders holding encoded
// content). Fully offline we can only trust what's on the device, so we
// filter to downloads client-side regardless of the toggle.
const encodedOnlyRequest = computed(
  () => !isOffline.value && downloads.downloadedOnly
);

// Path prefix shared by everything directly inside this folder. Empty at
// the root, so `videoId.startsWith(prefix)` is always true there.
const childPrefix = computed(() => (props.path ? `${props.path}/` : ""));

/**
 * Downloaded content living (transitively) under the current folder, derived
 * straight from the download registry rather than the server listing. This is
 * what lets a folder holding downloads — and the downloaded files themselves —
 * show even when this folder's listing was never cached from the server.
 */
const downloadedHere = computed(() => {
  const prefix = childPrefix.value;
  const dirs = new Map<string, MediaDirectoryEntry>();
  const fileIds = new Set<string>();
  for (const videoId of downloads.downloadedIds) {
    if (prefix && !videoId.startsWith(prefix)) continue;
    const rest = videoId.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      fileIds.add(videoId);
    } else {
      const name = rest.slice(0, slash);
      const path = `${prefix}${name}`;
      dirs.set(path, { name, path });
    }
  }
  return { dirs, fileIds };
});

/** Builds a file entry for a downloaded video the server didn't list. */
function synthesizeDownloadedFile(videoId: string): MediaFileEntry {
  const name = videoId.slice(videoId.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return {
    name,
    path: videoId,
    sizeBytes: downloads.bytesFor(videoId) ?? 0,
    extension: dot === -1 ? "" : name.slice(dot),
    encodeStatus: "Encoded"
  };
}

const visibleDirectories = computed(() => {
  const downloadedDirs = downloadedHere.value.dirs;
  const merged = new Map<string, MediaDirectoryEntry>();
  for (const dir of result.value?.directories ?? []) {
    // Offline, only keep folders that (transitively) hold a download.
    if (isOffline.value && !downloadedDirs.has(dir.path)) continue;
    merged.set(dir.path, dir);
  }
  // Always surface folders with downloads, even if the server listing is
  // missing (uncached) or filtered them out.
  for (const [path, dir] of downloadedDirs) {
    if (!merged.has(path)) merged.set(path, dir);
  }
  return [...merged.values()];
});

const visibleFiles = computed(() => {
  const fileIds = downloadedHere.value.fileIds;
  const merged = new Map<string, MediaFileEntry>();
  for (const file of result.value?.files ?? []) {
    // Offline shows only downloaded files; online shows everything the
    // server listed (already filtered server-side when downloadedOnly).
    if (isOffline.value && !isDownloaded(file)) continue;
    merged.set(file.path, file);
  }
  // Always include downloaded files, even when the server listing for this
  // folder is missing or dropped them.
  for (const videoId of fileIds) {
    if (!merged.has(videoId))
      merged.set(videoId, synthesizeDownloadedFile(videoId));
  }
  return [...merged.values()];
});

const encodableCount = computed(
  () =>
    visibleFiles.value.filter(file => statusOf(file) === "NotEncoded").length
);

const isEmpty = computed(
  () => visibleDirectories.value.length === 0 && visibleFiles.value.length === 0
);

function encodingLabel(file: MediaFileEntry): string {
  const job = encodes.jobBySourcePath.get(file.path);
  if (job?.status === "Running" && job.progress != null) {
    return `Encoding ${Math.round(job.progress * 100)}%`;
  }
  return job?.status === "Running" ? "Encoding" : "Encode queued";
}

function fileCaption(file: MediaFileEntry): string {
  const parts: string[] = [];
  if (file.sizeBytes > 0) parts.push(formatBytes(file.sizeBytes));
  if (statusOf(file) === "NotEncoded") parts.push("Not encoded");
  const download = downloadItemOf(file);
  if (download?.status === "queued") parts.push("Download queued");
  else if (download?.status === "downloading") parts.push("Downloading…");
  else if (download?.status === "error") parts.push("Download failed");
  return parts.join(" · ");
}

async function encodeFile(file: MediaFileEntry) {
  pendingEncodes.value.add(file.path);
  error.value = "";
  try {
    await encodes.enqueueEncode(file.path, { autoDownload: false });
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Failed to queue the encode.";
  } finally {
    pendingEncodes.value.delete(file.path);
  }
}

async function encodeAll() {
  encodingAll.value = true;
  error.value = "";
  try {
    const targets = visibleFiles.value.filter(
      file => statusOf(file) === "NotEncoded"
    );
    for (const file of targets) {
      // eslint-disable-next-line no-await-in-loop
      await encodes.enqueueEncode(file.path, { autoDownload: false });
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to queue encodes.";
  } finally {
    encodingAll.value = false;
  }
}

function deleteFile(file: MediaFileEntry) {
  downloads.deleteDownload(file.path);
}

async function load() {
  const path = props.path;
  const encodedOnly = encodedOnlyRequest.value;
  const isStale = () =>
    props.path !== path || encodedOnlyRequest.value !== encodedOnly;

  const cacheKey = `${encodedOnly ? "encoded" : "all"}:${path}`;
  const cached = browseCache.get(cacheKey);
  error.value = "";
  if (cached) {
    // Render the last listing synchronously so returning to a folder is
    // instant and the router can restore the scroll position onto a list
    // that already has its full height — then revalidate in the background.
    result.value = cached;
    loading.value = false;
  } else {
    loading.value = true;
  }

  try {
    const fresh = await browseMedia(path, { encodedOnly });
    browseCache.set(cacheKey, fresh);
    if (!isStale()) result.value = fresh;
  } catch (e) {
    if (isStale() || cached) return; // keep showing the cached listing
    error.value = isOffline.value
      ? "This folder hasn't been saved for offline browsing yet."
      : e instanceof Error
        ? e.message
        : "Failed to load media.";
  } finally {
    if (!isStale()) loading.value = false;
  }
}

watch([() => props.path, encodedOnlyRequest], load, { immediate: true });
</script>
