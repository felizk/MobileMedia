<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h6">Download queue</div>
      <q-space />
      <q-btn
        flat
        no-caps
        color="primary"
        icon="delete_sweep"
        label="Clear finished"
        :disable="downloads.finishedCount === 0"
        @click="downloads.clearFinished()"
      />
    </div>

    <q-list v-if="jobList.length" bordered separator>
      <q-item v-for="item in jobList" :key="item.videoId">
        <q-item-section avatar>
          <q-spinner
            v-if="item.status === 'downloading'"
            color="green"
            size="24px"
          />
          <q-icon v-else v-bind="statusIcon(item.status)" size="24px" />
        </q-item-section>

        <q-item-section>
          <q-item-label>{{ fileName(item.name) }}</q-item-label>
          <q-item-label caption class="ellipsis">{{
            directoryName(item.videoId)
          }}</q-item-label>
          <q-item-label
            v-if="item.status === 'error' && item.error"
            caption
            class="text-negative"
          >
            {{ item.error }}
          </q-item-label>
          <template v-if="item.status === 'downloading'">
            <q-linear-progress
              :value="item.progress ?? 0"
              :indeterminate="item.progress == null"
              color="green"
              class="q-mt-xs"
              rounded
            />
            <q-item-label caption>{{ progressLabel(item) }}</q-item-label>
          </template>
        </q-item-section>

        <q-item-section side>
          <div class="row items-center q-gutter-xs">
            <q-badge :color="statusColor(item.status)" outline>{{
              statusLabel(item.status)
            }}</q-badge>
            <q-btn
              v-if="item.status === 'error'"
              flat
              round
              dense
              icon="refresh"
              color="primary"
              aria-label="Retry download"
              @click="downloads.retry(item.videoId)"
            >
              <q-tooltip>Retry</q-tooltip>
            </q-btn>
            <q-btn
              flat
              round
              dense
              icon="close"
              color="negative"
              aria-label="Remove download"
              @click="removeItem(item)"
            >
              <q-tooltip>{{
                item.status === "done" ? "Delete from device" : "Cancel"
              }}</q-tooltip>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>

    <div v-else class="text-grey q-pa-lg text-center"
      >The download queue is empty.</div
    >
  </q-page>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  type DownloadItem,
  type DownloadStatus,
  useDownloadsStore
} from "@/stores/downloads";

const downloads = useDownloadsStore();

const jobList = computed(() => [...downloads.items.values()]);

/** A completed download is deleted from the device; anything else is cancelled and its partial bytes purged. */
function removeItem(item: DownloadItem) {
  if (item.status === "done") downloads.deleteDownload(item.videoId);
  else downloads.cancelDownload(item.videoId);
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function directoryName(path: string): string {
  return path.split("/").slice(0, -1).join("/") || "/";
}

function progressLabel(item: DownloadItem): string {
  return item.progress != null
    ? `${Math.round(item.progress * 100)}%`
    : "starting…";
}

function statusLabel(status: DownloadStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "done":
      return "Downloaded";
    case "error":
      return "Failed";
  }
}

function statusColor(status: DownloadStatus): string {
  switch (status) {
    case "queued":
      return "grey";
    case "downloading":
      return "green";
    case "done":
      return "positive";
    case "error":
      return "negative";
  }
}

function statusIcon(status: DownloadStatus): { name: string; color: string } {
  switch (status) {
    case "queued":
      return { name: "schedule", color: "grey" };
    case "done":
      return { name: "check_circle", color: "positive" };
    case "error":
      return { name: "error", color: "negative" };
    default:
      return { name: "download", color: "grey" };
  }
}
</script>
