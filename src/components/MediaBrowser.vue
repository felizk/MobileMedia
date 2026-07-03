<template>
  <q-page class="q-pa-md">
    <q-breadcrumbs class="q-mb-md">
      <q-breadcrumbs-el label="Home" icon="home" to="/" />
      <q-breadcrumbs-el
        v-for="crumb in breadcrumbs"
        :key="crumb.path"
        :label="crumb.name"
        :to="toBrowsePath(crumb.path)"
      />
    </q-breadcrumbs>

    <q-banner v-if="isOffline" class="bg-warning text-white q-mb-md" rounded>
      You're offline — showing the last saved listing for this folder, if any.
    </q-banner>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      {{ error }}
    </q-banner>

    <q-linear-progress v-else-if="loading" indeterminate color="primary" class="q-mb-md" />

    <q-list v-else bordered separator>
      <q-item
        v-for="dir in result?.directories ?? []"
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
        v-for="file in result?.files ?? []"
        :key="file.path"
        clickable
        :to="toWatchPath(file.path)"
      >
        <q-item-section avatar>
          <q-icon name="movie" color="secondary" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ file.name }}</q-item-label>
          <q-item-label caption>{{ formatBytes(file.sizeBytes) }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="isDownloaded(file)" side>
          <q-icon name="offline_pin" color="positive">
            <q-tooltip>Downloaded for offline</q-tooltip>
          </q-icon>
        </q-item-section>
      </q-item>

      <q-item v-if="isEmpty">
        <q-item-section class="text-grey">This folder is empty.</q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  browseMedia,
  getStreamUrl,
  toBrowsePath,
  toWatchPath,
  type BrowseResult,
  type MediaFileEntry
} from "@/services/media-api";
import { getDownloadedUrls } from "@/services/offline-video-status";
import { onDownloadMessage } from "@/services/offline-video";

const props = defineProps<{ path: string }>();

const result = ref<BrowseResult | null>(null);
const loading = ref(true);
const error = ref("");
const downloadedUrls = ref<Set<string>>(new Set());

function isDownloaded(file: MediaFileEntry): boolean {
  return downloadedUrls.value.has(getStreamUrl(file.path));
}

async function refreshDownloadedStatus(files: MediaFileEntry[]) {
  downloadedUrls.value = await getDownloadedUrls(files.map((file) => getStreamUrl(file.path)));
}

const unsubscribeDownloads = onDownloadMessage((message) => {
  if (message.type === "download-done") void refreshDownloadedStatus(result.value?.files ?? []);
});
onUnmounted(unsubscribeDownloads);

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
  return segments.map((name) => {
    cumulative = cumulative ? `${cumulative}/${name}` : name;
    return { name, path: cumulative };
  });
});

const isEmpty = computed(
  () => (result.value?.directories.length ?? 0) === 0 && (result.value?.files.length ?? 0) === 0
);

async function load(path: string) {
  loading.value = true;
  error.value = "";
  try {
    result.value = await browseMedia(path);
    void refreshDownloadedStatus(result.value.files);
  } catch (e) {
    error.value = isOffline.value
      ? "This folder hasn't been saved for offline browsing yet."
      : e instanceof Error
        ? e.message
        : "Failed to load media.";
  } finally {
    loading.value = false;
  }
}

watch(() => props.path, load, { immediate: true });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
</script>
