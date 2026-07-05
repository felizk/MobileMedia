<template>
  <q-page class="q-pa-md">
    <div class="text-h6 q-mb-md">Storage</div>

    <!-- Persistence -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section class="row items-center no-wrap">
        <q-icon
          :name="persistIcon"
          :color="persistColor"
          size="32px"
          class="q-mr-md"
        />
        <div class="col">
          <div class="text-subtitle1">{{ persistTitle }}</div>
          <div class="text-caption text-grey">{{ persistSubtitle }}</div>
        </div>
      </q-card-section>

      <q-card-section class="text-body2">
        Persistent storage stops the browser from clearing your downloads to
        reclaim space — and on iOS, from clearing them after a week of not
        opening the app. Once granted, downloads can only be removed by deleting
        them here. It doesn't change how much space you have.
      </q-card-section>

      <q-card-actions v-if="downloads.storagePersistenceSupported">
        <q-btn
          v-if="downloads.storagePersisted !== true"
          color="primary"
          no-caps
          label="Protect my downloads"
          :loading="requesting"
          @click="enablePersistence"
        />
        <div v-if="requestDenied" class="text-caption text-warning q-pa-sm">
          The browser didn't grant persistence. Installing this app to your home
          screen usually lets it be granted.
        </div>
      </q-card-actions>
    </q-card>

    <!-- Usage -->
    <q-card v-if="downloads.storageQuota != null" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="row items-center justify-between q-mb-sm">
          <div class="text-subtitle1">Space used by this app</div>
          <q-btn
            flat
            dense
            round
            icon="refresh"
            :loading="refreshing"
            @click="refresh"
          >
            <q-tooltip>Refresh</q-tooltip>
          </q-btn>
        </div>

        <q-linear-progress
          :value="usedFraction"
          :color="usedFraction > 0.9 ? 'negative' : 'primary'"
          size="12px"
          rounded
          class="q-mb-sm"
        />

        <div class="row justify-between text-caption text-grey">
          <span>{{ usageLabel }} used</span>
          <span>{{ availableLabel }} free</span>
        </div>
        <div class="text-caption text-grey q-mt-xs">
          Of {{ quotaLabel }} the browser makes available to this app. This is a
          share of the device's free space, not its total capacity, and counts
          all of the app's stored data — not only downloaded videos.
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered>
      <q-item>
        <q-item-section>
          <q-item-label>Downloaded videos</q-item-label>
          <q-item-label caption>Ready to watch offline</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge color="primary">{{ downloads.downloadedIds.size }}</q-badge>
        </q-item-section>
      </q-item>
    </q-card>

    <div
      v-if="
        !downloads.storagePersistenceSupported && downloads.storageQuota == null
      "
      class="text-grey q-pa-md text-center"
    >
      This browser doesn't expose storage information.
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useDownloadsStore } from "@/stores/downloads";
import { formatBytes } from "@/utils/format-bytes";

const downloads = useDownloadsStore();

const requesting = ref(false);
const requestDenied = ref(false);
const refreshing = ref(false);

const persisted = computed(() => downloads.storagePersisted);

const persistIcon = computed(() => {
  if (!downloads.storagePersistenceSupported) return "help";
  if (persisted.value === true) return "verified_user";
  return "gpp_maybe";
});
const persistColor = computed(() => {
  if (!downloads.storagePersistenceSupported) return "grey";
  return persisted.value === true ? "positive" : "warning";
});
const persistTitle = computed(() => {
  if (!downloads.storagePersistenceSupported) return "Persistence unavailable";
  return persisted.value === true
    ? "Downloads are protected"
    : "Downloads aren't protected yet";
});
const persistSubtitle = computed(() => {
  if (!downloads.storagePersistenceSupported) {
    return "This browser can't guarantee stored downloads.";
  }
  return persisted.value === true
    ? "The browser won't clear them to free up space."
    : "The browser may clear them when space runs low.";
});

const usedFraction = computed(() => {
  const quota = downloads.storageQuota;
  const usage = downloads.storageUsage;
  if (!quota || usage == null) return 0;
  return Math.min(1, usage / quota);
});

const usageLabel = computed(() =>
  downloads.storageUsage == null ? "—" : formatBytes(downloads.storageUsage)
);
const availableLabel = computed(() =>
  downloads.storageAvailable == null
    ? "—"
    : formatBytes(downloads.storageAvailable)
);
const quotaLabel = computed(() =>
  downloads.storageQuota == null ? "—" : formatBytes(downloads.storageQuota)
);

async function enablePersistence() {
  requesting.value = true;
  requestDenied.value = false;
  try {
    const granted = await downloads.requestPersistence();
    requestDenied.value = !granted;
  } finally {
    requesting.value = false;
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    await Promise.all([
      downloads.refreshStorageEstimate(),
      downloads.refreshPersisted()
    ]);
  } finally {
    refreshing.value = false;
  }
}

onMounted(refresh);
</script>
