<template>
  <q-page class="q-pa-md column items-center">
    <div class="full-width" style="max-width: 900px">
      <q-breadcrumbs class="q-mb-md">
        <q-breadcrumbs-el label="Home" icon="home" to="/" />
        <q-breadcrumbs-el
          v-for="crumb in directoryBreadcrumbs"
          :key="crumb.path"
          :label="crumb.name"
          :to="toBrowsePath(crumb.path)"
        />
        <q-breadcrumbs-el :label="fileName" />
      </q-breadcrumbs>

      <q-banner v-if="isOffline" class="bg-warning text-white q-mb-md" rounded>
        You're offline{{ isDownloaded ? " — playing your downloaded copy." : "." }}
      </q-banner>

      <video v-if="canPlay" controls crossorigin="anonymous" :src="streamUrl" class="full-width" />
      <div
        v-else
        class="full-width bg-grey-3 text-grey-8 column items-center q-pa-xl rounded-borders"
      >
        <q-icon name="cloud_off" size="48px" class="q-mb-sm" />
        This video hasn't been downloaded, so it can't be played offline.
      </div>

      <div class="row items-center q-mt-md q-gutter-sm">
        <q-chip v-if="isDownloaded" color="positive" text-color="white" icon="offline_pin">
          Downloaded for offline
        </q-chip>

        <q-btn
          v-else-if="!isOffline"
          color="primary"
          label="Download for offline"
          no-caps
          :loading="downloading"
          @click="startDownload"
        />

        <div v-else class="text-grey">Connect to the internet to download this video.</div>

        <div>{{ status }}</div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getStreamUrl, toBrowsePath } from "@/services/media-api";
import { onDownloadMessage, requestVideoDownload } from "@/services/offline-video";
import { getDownloadedUrls } from "@/services/offline-video-status";

const route = useRoute("//watch/[...path]");
const path = computed(() => route.params.path);
const streamUrl = computed(() => getStreamUrl(path.value));

const segments = computed(() => path.value.split("/").filter(Boolean));
const fileName = computed(() => segments.value.at(-1) ?? "");
const directoryBreadcrumbs = computed(() => {
  let cumulative = "";
  return segments.value.slice(0, -1).map((name) => {
    cumulative = cumulative ? `${cumulative}/${name}` : name;
    return { name, path: cumulative };
  });
});

const downloading = ref(false);
const status = ref("");
const isDownloaded = ref(false);

async function refreshDownloadedStatus() {
  const downloaded = await getDownloadedUrls([streamUrl.value]);
  isDownloaded.value = downloaded.has(streamUrl.value);
}
watch(streamUrl, refreshDownloadedStatus, { immediate: true });

const isOffline = ref(!navigator.onLine);
const updateOnlineStatus = () => {
  isOffline.value = !navigator.onLine;
};
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

const canPlay = computed(() => isDownloaded.value || !isOffline.value);

const unsubscribe = onDownloadMessage((message) => {
  if (message.videoId !== path.value) return;

  if (message.type === "download-progress") {
    status.value = `Downloading… ${Math.round(message.progress * 100)}%`;
  } else if (message.type === "download-done") {
    downloading.value = false;
    status.value = "";
    isDownloaded.value = true;
  } else if (message.type === "download-error") {
    downloading.value = false;
    status.value = `Error: ${message.message}`;
  }
});

onUnmounted(() => {
  unsubscribe();
  window.removeEventListener("online", updateOnlineStatus);
  window.removeEventListener("offline", updateOnlineStatus);
});

async function startDownload() {
  downloading.value = true;
  status.value = "Starting download…";
  await requestVideoDownload(path.value, streamUrl.value);
}
</script>
