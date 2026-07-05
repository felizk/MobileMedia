import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  cancelEncodeJob,
  clearFinishedEncodeJobs,
  fetchEncodeQueue,
  getEncodeQueueWsUrl,
  isFinishedStatus,
  queueEncode,
  requeueEncodeJob,
  type EncodeJob
} from "@/services/encode-api";
import { getStreamUrl } from "@/services/media-api";
import { useDownloadsStore } from "./downloads";

const AUTO_DOWNLOAD_STORAGE_KEY = "mm-auto-download-jobs";
const RECONNECT_DELAY_MS = 4000;
/** How long after (re)connecting before assuming the snapshot has fully arrived. */
const SNAPSHOT_SETTLE_MS = 2000;

/**
 * Live mirror of the server's encode queue, fed by its WebSocket.
 *
 * Also remembers which jobs were queued with "download when done" (persisted
 * across reloads) and pushes those into the downloads store on completion.
 */
export const useEncodesStore = defineStore("encodes", () => {
  const jobs = ref(new Map<string, EncodeJob>());
  const connected = ref(false);
  let initialized = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const downloads = useDownloadsStore();

  /** jobId -> source path to auto-download once that job completes. */
  let autoDownloadJobs = new Map<string, string>();

  function loadAutoDownloads() {
    try {
      const raw = localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY);
      if (raw)
        autoDownloadJobs = new Map(
          Object.entries(JSON.parse(raw) as Record<string, string>)
        );
    } catch {
      autoDownloadJobs = new Map();
    }
  }

  function persistAutoDownloads() {
    try {
      localStorage.setItem(
        AUTO_DOWNLOAD_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(autoDownloadJobs))
      );
    } catch {
      // Best-effort; auto-download intent is lost on reload at worst.
    }
  }

  // Sort by `order`, not `queuedAt`: a requeued job keeps its original
  // `queuedAt` but moves to the front of the queue via a new `order`.
  const jobList = computed(() =>
    [...jobs.value.values()].sort((a, b) => a.order - b.order)
  );
  const runningJob = computed(
    () => jobList.value.find(job => job.status === "Running") ?? null
  );
  const queuedCount = computed(
    () => jobList.value.filter(job => job.status === "Queued").length
  );
  const finishedCount = computed(
    () => jobList.value.filter(job => isFinishedStatus(job.status)).length
  );
  const activeCount = computed(
    () => queuedCount.value + (runningJob.value ? 1 : 0)
  );

  /**
   * Latest job per source path (by queue order), so browse listings can
   * overlay live encode state on top of the static `encodeStatus` field.
   */
  const jobBySourcePath = computed(() => {
    const map = new Map<string, EncodeJob>();
    for (const job of jobList.value) {
      // An active (Queued/Running) job describes the file's current state
      // better than any finished one, wherever it sits in the queue order.
      const existing = map.get(job.sourcePath);
      if (existing && !isFinishedStatus(existing.status)) continue;
      map.set(job.sourcePath, job);
    }
    return map;
  });

  function upsertJob(job: EncodeJob) {
    jobs.value.set(job.id, job);

    if (!isFinishedStatus(job.status)) return;
    const sourcePath = autoDownloadJobs.get(job.id);
    if (sourcePath === undefined) return;

    autoDownloadJobs.delete(job.id);
    persistAutoDownloads();
    if (job.status === "Completed") {
      const name = sourcePath.split("/").at(-1) ?? sourcePath;
      downloads.enqueue(sourcePath, getStreamUrl(sourcePath), name);
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (socket) return;
    if (!navigator.onLine) return; // the "online" listener reconnects us

    const ws = new WebSocket(getEncodeQueueWsUrl());
    socket = ws;

    ws.onopen = () => {
      connected.value = true;
      // The server replays every job on connect, so start from a clean
      // slate instead of merging — stale entries (e.g. cleared-finished
      // jobs) would otherwise linger forever.
      jobs.value = new Map();

      // Auto-download intents for jobs the server no longer knows about
      // (e.g. cleared from the list by another client) can never fire —
      // prune them once the snapshot has had time to arrive.
      setTimeout(() => {
        if (socket !== ws) return;
        for (const jobId of autoDownloadJobs.keys()) {
          if (!jobs.value.has(jobId)) autoDownloadJobs.delete(jobId);
        }
        persistAutoDownloads();
      }, SNAPSHOT_SETTLE_MS);
    };
    ws.onmessage = event => {
      upsertJob(JSON.parse(event.data as string) as EncodeJob);
    };
    ws.onclose = () => {
      connected.value = false;
      if (socket === ws) socket = null;
      scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  /**
   * Queues an encode. With `autoDownload`, the encoded file is added to the
   * download queue as soon as the job completes.
   */
  async function enqueueEncode(
    path: string,
    opts?: { autoDownload?: boolean }
  ): Promise<EncodeJob> {
    const job = await queueEncode(path);
    if (opts?.autoDownload) {
      autoDownloadJobs.set(job.id, job.sourcePath);
      persistAutoDownloads();
    }
    upsertJob(job);
    return job;
  }

  /** Requeues a Failed/Canceled job under the same id, at the queue front. */
  async function requeueJob(id: string) {
    upsertJob(await requeueEncodeJob(id));
  }

  async function cancelJob(id: string) {
    // A running job answers 202 still marked Running; the Canceled
    // transition follows over the WebSocket moments later.
    upsertJob(await cancelEncodeJob(id));
  }

  async function clearFinished() {
    await clearFinishedEncodeJobs();
    // No WebSocket message accompanies removals — refetch and replace.
    const list = await fetchEncodeQueue();
    jobs.value = new Map(list.map(job => [job.id, job]));
  }

  function init() {
    if (initialized) return;
    initialized = true;

    loadAutoDownloads();
    connect();
    window.addEventListener("online", connect);
    window.addEventListener("offline", () => socket?.close());
  }

  return {
    jobs,
    connected,
    jobList,
    runningJob,
    queuedCount,
    finishedCount,
    activeCount,
    jobBySourcePath,
    enqueueEncode,
    requeueJob,
    cancelJob,
    clearFinished,
    init
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useEncodesStore, import.meta.hot));
}
