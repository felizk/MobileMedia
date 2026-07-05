<template>
  <div
    v-if="visible"
    class="column items-end justify-center cursor-pointer"
    @click="$router.push('/storage')"
  >
    <div class="row items-center no-wrap text-caption">
      <q-icon
        v-if="downloads.storageAtRisk"
        name="warning"
        color="warning"
        size="16px"
        class="q-mr-xs"
      />
      <q-icon v-else name="sd_storage" size="16px" class="q-mr-xs" />
      <template v-if="downloads.storageAvailable != null">
        {{ formatBytes(downloads.storageAvailable) }} free
      </template>
      <template v-else>Storage</template>
    </div>
    <q-linear-progress
      v-if="downloads.storageAvailable != null"
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

const visible = computed(
  () =>
    downloads.storageAvailable != null || downloads.storagePersistenceSupported
);

const usedFraction = computed(() => {
  const quota = downloads.storageQuota;
  const usage = downloads.storageUsage;
  if (!quota || usage == null) return 0;
  return Math.min(1, usage / quota);
});

const tooltip = computed(() => {
  if (downloads.storageAtRisk) {
    return "Downloads aren't protected yet — tap for storage settings";
  }
  const usage = downloads.storageUsage;
  const quota = downloads.storageQuota;
  if (usage == null || quota == null) return "Tap for storage settings";
  return `${formatBytes(usage)} used of ${formatBytes(quota)} available — tap for settings`;
});
</script>
