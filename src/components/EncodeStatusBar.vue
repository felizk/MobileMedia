<template>
  <div class="q-px-md q-py-sm cursor-pointer" @click="goToQueue">
    <template v-if="isOffline">
      <div class="row items-center no-wrap text-caption">
        <q-icon name="cloud_off" size="18px" class="q-mr-sm" />
        Offline — showing downloaded videos only
      </div>
    </template>

    <template v-else-if="!encodes.connected">
      <div class="row items-center no-wrap text-caption">
        <q-icon name="sync_problem" size="18px" class="q-mr-sm" />
        Connecting to encoder…
      </div>
    </template>

    <template v-else-if="encodes.runningJob">
      <div class="row items-center no-wrap text-caption">
        <q-icon name="movie_filter" size="18px" class="q-mr-sm" />
        <div class="col ellipsis">Encoding {{ runningName }}</div>
        <div class="q-ml-sm text-no-wrap">{{ progressLabel }}</div>
        <q-badge v-if="encodes.queuedCount" color="orange" class="q-ml-sm">
          {{ encodes.queuedCount }} queued
        </q-badge>
      </div>
      <q-linear-progress
        :value="encodes.runningJob.progress ?? 0"
        :indeterminate="encodes.runningJob.progress == null"
        color="orange"
        track-color="grey-8"
        class="q-mt-xs"
        rounded
      />
    </template>

    <template v-else>
      <div class="row items-center no-wrap text-caption">
        <q-icon name="hourglass_empty" size="18px" class="q-mr-sm" />
        <div class="col">Encoder idle</div>
        <q-badge v-if="encodes.queuedCount" color="orange">
          {{ encodes.queuedCount }} queued
        </q-badge>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useEncodesStore } from "@/stores/encodes";

const encodes = useEncodesStore();
const router = useRouter();

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

const runningName = computed(
  () => encodes.runningJob?.sourcePath.split("/").at(-1) ?? ""
);

const progressLabel = computed(() => {
  const job = encodes.runningJob;
  if (!job) return "";
  const percent =
    job.progress != null ? `${Math.round(job.progress * 100)}%` : "starting…";
  return job.etaSeconds
    ? `${percent} · ${formatEta(job.etaSeconds)}`
    : `${percent} · calculating…`;
});

function formatEta(seconds: number): string {
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m left`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m left`;
  return `${Math.round(seconds)}s left`;
}

function goToQueue() {
  void router.push("/encodes");
}
</script>
