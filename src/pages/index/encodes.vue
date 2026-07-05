<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h6">Encode queue</div>
      <q-space />
      <q-btn
        flat
        no-caps
        color="primary"
        icon="delete_sweep"
        label="Clear finished"
        :disable="encodes.finishedCount === 0"
        :loading="clearing"
        @click="clearFinished"
      />
    </div>

    <q-banner
      v-if="!encodes.connected"
      class="bg-warning text-white q-mb-md"
      rounded
    >
      Not connected to the encoder — this list may be out of date.
    </q-banner>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      {{ error }}
    </q-banner>

    <q-list v-if="encodes.jobList.length" bordered separator>
      <q-item v-for="job in encodes.jobList" :key="job.id">
        <q-item-section avatar>
          <q-spinner
            v-if="job.status === 'Running'"
            color="orange"
            size="24px"
          />
          <q-icon v-else v-bind="statusIcon(job.status)" size="24px" />
        </q-item-section>

        <q-item-section>
          <q-item-label>{{ fileName(job.sourcePath) }}</q-item-label>
          <q-item-label caption class="ellipsis">{{
            directoryName(job.sourcePath)
          }}</q-item-label>
          <q-item-label
            v-if="job.status === 'Failed' && job.errorMessage"
            caption
            class="text-negative"
          >
            {{ job.errorMessage }}
          </q-item-label>
          <q-item-label v-if="encodeDuration(job)" caption>
            Encoded in {{ encodeDuration(job) }}
          </q-item-label>
          <template v-if="job.status === 'Running'">
            <q-linear-progress
              :value="job.progress ?? 0"
              :indeterminate="job.progress == null"
              color="orange"
              class="q-mt-xs"
              rounded
            />
            <q-item-label caption>{{ progressLabel(job) }}</q-item-label>
          </template>
        </q-item-section>

        <q-item-section side>
          <div class="row items-center q-gutter-xs">
            <q-badge :color="statusColor(job.status)" outline>{{
              job.status
            }}</q-badge>
            <q-btn
              v-if="job.status === 'Queued' || job.status === 'Running'"
              flat
              round
              dense
              icon="cancel"
              color="negative"
              :loading="cancelling.has(job.id)"
              aria-label="Cancel encode"
              @click="cancelJob(job.id)"
            >
              <q-tooltip>Cancel</q-tooltip>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>

    <div v-else class="text-grey q-pa-lg text-center"
      >The encode queue is empty.</div
    >
  </q-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { EncodeJob, EncodeJobStatus } from "@/services/encode-api";
import { useEncodesStore } from "@/stores/encodes";

const encodes = useEncodesStore();

const clearing = ref(false);
const cancelling = ref(new Set<string>());
const error = ref("");

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function directoryName(path: string): string {
  return path.split("/").slice(0, -1).join("/") || "/";
}

function progressLabel(job: EncodeJob): string {
  const percent =
    job.progress != null ? `${Math.round(job.progress * 100)}%` : "starting…";
  if (!job.etaSeconds) return `${percent} · calculating…`;
  const minutes = Math.round(job.etaSeconds / 60);
  return minutes >= 1
    ? `${percent} · ${minutes}m left`
    : `${percent} · ${Math.round(job.etaSeconds)}s left`;
}

/** "3m 12s"-style wall-clock time of a completed encode, or "" when n/a. */
function encodeDuration(job: EncodeJob): string {
  if (job.status !== "Completed" || !job.startedAt || !job.completedAt) {
    return "";
  }
  const seconds = Math.round(
    (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000
  );
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusColor(status: EncodeJobStatus): string {
  switch (status) {
    case "Queued":
      return "grey";
    case "Running":
      return "orange";
    case "Completed":
      return "positive";
    case "Failed":
      return "negative";
    case "Canceled":
      return "warning";
  }
}

function statusIcon(status: EncodeJobStatus): { name: string; color: string } {
  switch (status) {
    case "Queued":
      return { name: "schedule", color: "grey" };
    case "Completed":
      return { name: "check_circle", color: "positive" };
    case "Failed":
      return { name: "error", color: "negative" };
    case "Canceled":
      return { name: "cancel", color: "warning" };
    default:
      return { name: "movie", color: "grey" };
  }
}

async function cancelJob(id: string) {
  cancelling.value.add(id);
  error.value = "";
  try {
    await encodes.cancelJob(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to cancel the job.";
  } finally {
    cancelling.value.delete(id);
  }
}

async function clearFinished() {
  clearing.value = true;
  error.value = "";
  try {
    await encodes.clearFinished();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Failed to clear finished jobs.";
  } finally {
    clearing.value = false;
  }
}
</script>
