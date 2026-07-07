<template>
  <!-- Downloading: circular progress with percent. -->
  <q-circular-progress
    v-if="item?.status === 'downloading'"
    :value="(item?.progress ?? 0) * 100"
    :indeterminate="item?.progress == null"
    show-value
    size="32px"
    color="primary"
    track-color="grey-4"
  >
    <span class="text-caption">{{
      Math.round((item?.progress ?? 0) * 100)
    }}</span>
  </q-circular-progress>

  <!-- Waiting behind the concurrency limit. -->
  <q-icon
    v-else-if="item?.status === 'queued'"
    name="downloading"
    color="grey"
    size="24px"
  >
    <q-tooltip>Waiting in download queue</q-tooltip>
  </q-icon>

  <!-- Failed: show the error and offer a retry. -->
  <q-btn
    v-else-if="item?.status === 'error'"
    dense
    round
    flat
    icon="sync_problem"
    color="negative"
    aria-label="Retry download"
    @click.stop.prevent="downloads.retry(videoId)"
  >
    <q-tooltip>{{ item?.error }} — tap to retry</q-tooltip>
  </q-btn>

  <!-- Nothing in flight yet: start a download. -->
  <q-btn
    v-else-if="canDownload && !downloads.isDownloaded(videoId)"
    dense
    round
    flat
    icon="download"
    color="primary"
    aria-label="Download for offline"
    @click.stop.prevent="downloads.enqueue(videoId, url, name)"
  >
    <q-tooltip>Download for offline</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useDownloadsStore } from "@/stores/downloads";

const props = defineProps<{
  /** Source-tree path used as the offline-storage id. */
  videoId: string;
  /** Media stream URL the bytes are fetched from. */
  url: string;
  /** Display name for the download queue. */
  name: string;
  /** Whether a fresh download may be started (encoded & online). */
  canDownload?: boolean;
}>();

const downloads = useDownloadsStore();
const item = computed(() => downloads.itemFor(props.videoId));
</script>
