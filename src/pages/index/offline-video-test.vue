<template>
  <q-page class="q-pa-md column items-center">
    <!-- Temporary page for verifying offline video caching. Delete once real download UI exists. -->
    <video
      ref="videoEl"
      controls
      crossorigin="anonymous"
      src="https://mmbe.felizk.net/api/media/stream/BigBuckBunny_320x180.mp4"
      style="max-width: 100%; width: 640px"
    />

    <q-btn
      class="q-mt-md"
      color="primary"
      label="Download for offline"
      no-caps
      :loading="downloading"
      @click="startDownload"
    />

    <p class="q-mt-md">{{ status }}</p>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from "vue";

const VIDEO_ID = "big-buck-bunny";
const VIDEO_URL = "https://mmbe.felizk.net/api/media/stream/BigBuckBunny_320x180.mp4";

const downloading = ref(false);
const status = ref("Not downloaded.");

interface WorkerMessage {
  type: "download-progress" | "download-done" | "download-error";
  videoId: string;
  progress?: number;
  message?: string;
}

navigator.serviceWorker?.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;
  if (data.videoId !== VIDEO_ID) return;

  if (data.type === "download-progress") {
    status.value = `Downloading… ${Math.round((data.progress ?? 0) * 100)}%`;
  } else if (data.type === "download-done") {
    downloading.value = false;
    status.value = "Downloaded — available offline.";
  } else if (data.type === "download-error") {
    downloading.value = false;
    status.value = `Error: ${data.message}`;
  }
});

async function startDownload() {
  const registration = await navigator.serviceWorker.ready;
  downloading.value = true;
  status.value = "Starting download…";
  registration.active?.postMessage({
    type: "download-video",
    videoId: VIDEO_ID,
    url: VIDEO_URL
  });
}
</script>
