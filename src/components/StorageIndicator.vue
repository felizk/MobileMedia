<template>
  <div
    v-if="downloads.storageAvailable != null"
    class="column items-end justify-center"
  >
    <div class="row items-center no-wrap text-caption">
      <q-icon name="sd_storage" size="16px" class="q-mr-xs" />
      {{ formatBytes(downloads.storageAvailable) }} free
    </div>
    <q-linear-progress
      :value="usedFraction"
      :color="usedFraction > 0.9 ? 'negative' : 'primary'"
      track-color="grey-8"
      style="width: 88px"
      class="q-mt-xs"
      rounded
    />
    <q-tooltip>{{ tooltip }}</q-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useDownloadsStore } from "@/stores/downloads";
import { formatBytes } from "@/utils/format-bytes";

const downloads = useDownloadsStore();

const usedFraction = computed(() => {
  const quota = downloads.storageQuota;
  const usage = downloads.storageUsage;
  if (!quota || usage == null) return 0;
  return Math.min(1, usage / quota);
});

const tooltip = computed(() => {
  const usage = downloads.storageUsage;
  const quota = downloads.storageQuota;
  if (usage == null || quota == null) return "";
  return `${formatBytes(usage)} used of ${formatBytes(quota)} available to this app`;
});
</script>
