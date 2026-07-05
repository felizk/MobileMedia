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
        You're offline{{
          isDownloaded ? " — playing your downloaded copy." : "."
        }}
      </q-banner>

      <video
        v-if="canPlay"
        controls
        crossorigin="anonymous"
        :src="streamUrl"
        class="full-width"
      />
      <div
        v-else
        class="full-width bg-grey-3 text-grey-8 column items-center q-pa-xl rounded-borders"
      >
        <q-icon name="cloud_off" size="48px" class="q-mb-sm" />
        This video hasn't been downloaded, so it can't be played offline.
      </div>

      <div class="row items-center q-mt-md q-gutter-sm">
        <template v-if="isDownloaded">
          <q-chip color="positive" text-color="white" icon="offline_pin">
            Downloaded for offline
          </q-chip>
          <q-btn
            outline
            color="negative"
            icon="delete"
            label="Delete from device"
            no-caps
            @click="confirmingDelete = true"
          />

          <q-dialog v-model="confirmingDelete">
            <q-card>
              <q-card-section class="row items-center">
                <q-icon
                  name="delete"
                  color="negative"
                  size="24px"
                  class="q-mr-sm"
                />
                Delete "{{ fileName }}" from this device?
              </q-card-section>
              <q-card-actions align="right">
                <q-btn v-close-popup flat label="Cancel" no-caps />
                <q-btn
                  v-close-popup
                  flat
                  color="negative"
                  label="Delete"
                  no-caps
                  @click="deleteDownload"
                />
              </q-card-actions>
            </q-card>
          </q-dialog>
        </template>

        <template v-else-if="downloadItem?.status === 'downloading'">
          <q-circular-progress
            :value="(downloadItem.progress ?? 0) * 100"
            :indeterminate="downloadItem.progress == null"
            show-value
            size="40px"
            color="primary"
            track-color="grey-4"
          >
            <span class="text-caption"
              >{{ Math.round((downloadItem.progress ?? 0) * 100) }}%</span
            >
          </q-circular-progress>
          <div>Downloading…</div>
        </template>

        <template v-else-if="downloadItem?.status === 'queued'">
          <q-chip color="grey" text-color="white" icon="downloading">
            Waiting in download queue
          </q-chip>
        </template>

        <template v-else-if="!isOffline">
          <q-btn
            color="primary"
            label="Download for offline"
            no-caps
            @click="startDownload"
          />
          <div v-if="downloadItem?.status === 'error'" class="text-negative">
            Download failed: {{ downloadItem.error }}
          </div>
        </template>

        <div v-else class="text-grey"
          >Connect to the internet to download this video.</div
        >
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getStreamUrl, toBrowsePath } from "@/services/media-api";
import { useDownloadsStore } from "@/stores/downloads";

const route = useRoute("//watch/[...path]");
const path = computed(() => route.params.path);
const streamUrl = computed(() => getStreamUrl(path.value));

const downloads = useDownloadsStore();

const segments = computed(() => path.value.split("/").filter(Boolean));
const fileName = computed(() => segments.value.at(-1) ?? "");
const directoryBreadcrumbs = computed(() => {
  let cumulative = "";
  return segments.value.slice(0, -1).map(name => {
    cumulative = cumulative ? `${cumulative}/${name}` : name;
    return { name, path: cumulative };
  });
});

const isDownloaded = computed(() => downloads.isDownloaded(path.value));
const downloadItem = computed(() => downloads.itemFor(path.value));
const confirmingDelete = ref(false);

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

const canPlay = computed(() => isDownloaded.value || !isOffline.value);

function startDownload() {
  downloads.enqueue(path.value, streamUrl.value, fileName.value);
}

function deleteDownload() {
  downloads.deleteDownload(path.value);
}
</script>
