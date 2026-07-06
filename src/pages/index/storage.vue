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

    <q-card flat bordered class="q-mt-md">
      <q-card-section class="row items-center no-wrap">
        <div class="col">
          <div class="text-subtitle1">Broken downloads</div>
          <div class="text-caption text-grey">
            Checks each downloaded video against the server — catches ones that
            got marked complete despite ending early.
          </div>
        </div>
        <q-btn
          flat
          no-caps
          color="primary"
          label="Check now"
          :loading="checking"
          :disable="downloads.downloadedIds.size === 0"
          @click="checkForBroken"
        />
      </q-card-section>

      <q-card-section v-if="brokenDownloads != null">
        <div v-if="brokenDownloads.length === 0" class="text-grey text-body2">
          All downloaded videos check out.
        </div>

        <q-list v-else bordered separator>
          <q-item v-for="item in brokenDownloads" :key="item.videoId">
            <q-item-section>
              <q-item-label>{{ fileName(item.videoId) }}</q-item-label>
              <q-item-label caption class="ellipsis">{{
                directoryName(item.videoId)
              }}</q-item-label>
              <q-item-label caption class="text-negative">
                {{ formatBytes(item.bytesStored) }} of
                {{ formatBytes(item.bytesExpected) }} saved
              </q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="row items-center q-gutter-xs">
                <q-btn
                  flat
                  dense
                  no-caps
                  icon="download"
                  label="Redownload"
                  color="primary"
                  :loading="redownloadingIds.has(item.videoId)"
                  @click="redownloadBroken(item)"
                />
                <q-btn
                  flat
                  dense
                  no-caps
                  icon="delete"
                  label="Delete"
                  color="negative"
                  :disable="redownloadingIds.has(item.videoId)"
                  @click="deleteBroken(item)"
                />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useDownloadsStore } from "@/stores/downloads";
import {
  type BrokenDownload,
  findBrokenDownloads
} from "@/services/offline-video-verify";
import { formatBytes } from "@/utils/format-bytes";

const downloads = useDownloadsStore();

const requesting = ref(false);
const requestDenied = ref(false);
const refreshing = ref(false);

const checking = ref(false);
const brokenDownloads = ref<BrokenDownload[] | null>(null);
const redownloadingIds = ref(new Set<string>());

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

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function directoryName(path: string): string {
  return path.split("/").slice(0, -1).join("/") || "/";
}

async function checkForBroken() {
  checking.value = true;
  try {
    brokenDownloads.value = await findBrokenDownloads();
  } finally {
    checking.value = false;
  }
}

function removeBroken(videoId: string) {
  brokenDownloads.value =
    brokenDownloads.value?.filter(item => item.videoId !== videoId) ?? null;
}

function deleteBroken(item: BrokenDownload) {
  downloads.deleteDownload(item.videoId);
  removeBroken(item.videoId);
}

async function redownloadBroken(item: BrokenDownload) {
  redownloadingIds.value.add(item.videoId);
  try {
    await downloads.redownload(item.videoId, item.url, fileName(item.videoId));
    removeBroken(item.videoId);
  } finally {
    redownloadingIds.value.delete(item.videoId);
  }
}
</script>
