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

      <video controls crossorigin="anonymous" :src="streamUrl" class="full-width" />

      <div class="row items-center q-mt-md q-gutter-sm">
        <q-btn
          color="primary"
          label="Download for offline"
          no-caps
          :loading="downloading"
          @click="startDownload"
        />
        <div>{{ status }}</div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getStreamUrl, toBrowsePath } from "@/services/media-api";
import { onDownloadMessage, requestVideoDownload } from "@/services/offline-video";

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

const unsubscribe = onDownloadMessage((message) => {
  if (message.videoId !== path.value) return;

  if (message.type === "download-progress") {
    status.value = `Downloading… ${Math.round(message.progress * 100)}%`;
  } else if (message.type === "download-done") {
    downloading.value = false;
    status.value = "Available offline.";
  } else if (message.type === "download-error") {
    downloading.value = false;
    status.value = `Error: ${message.message}`;
  }
});
onUnmounted(unsubscribe);

async function startDownload() {
  downloading.value = true;
  status.value = "Starting download…";
  await requestVideoDownload(path.value, streamUrl.value);
}
</script>
