import { API_ORIGIN } from "./media-api";

const API_BASE = `${API_ORIGIN}/api/encode`;

export type EncodeJobStatus =
  | "Queued"
  | "Running"
  | "Completed"
  | "Failed"
  | "Canceled";

export interface EncodeJob {
  id: string;
  sourcePath: string;
  destinationPath: string;
  status: EncodeJobStatus;
  /**
   * Opaque processing-order key — queued jobs run lowest-first. Sort by this,
   * not `queuedAt`: a requeued job keeps its `queuedAt` but gets a new front-
   * of-queue `order`. Only meaningful relative to jobs in the same snapshot.
   */
  order: number;
  /** Fraction 0–1, null until the first progress report. */
  progress: number | null;
  /** Null or 0 while HandBrake's rate estimate stabilizes. */
  etaSeconds: number | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export function isFinishedStatus(status: EncodeJobStatus): boolean {
  return status === "Completed" || status === "Failed" || status === "Canceled";
}

/** Queues an encode for a source-tree file path. No dedup server-side. */
export async function queueEncode(path: string): Promise<EncodeJob> {
  const response = await fetch(`${API_BASE}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
  if (!response.ok) {
    throw new Error(
      `Failed to queue encode for "${path}" (${response.status}).`
    );
  }
  return response.json() as Promise<EncodeJob>;
}

export async function fetchEncodeQueue(): Promise<EncodeJob[]> {
  const response = await fetch(`${API_BASE}/queue`);
  if (!response.ok) {
    throw new Error(`Failed to fetch encode queue (${response.status}).`);
  }
  return response.json() as Promise<EncodeJob[]>;
}

/**
 * Cancels a job. Idempotent: a running job returns 202 and keeps reporting
 * `Running` until the `Canceled` transition arrives over the WebSocket.
 */
export async function cancelEncodeJob(id: string): Promise<EncodeJob> {
  const response = await fetch(`${API_BASE}/queue/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to cancel encode job (${response.status}).`);
  }
  return response.json() as Promise<EncodeJob>;
}

/**
 * Re-enqueues a Failed/Canceled job under the same id, at the front of the
 * queue. 409 if the job is in any other state.
 */
export async function requeueEncodeJob(id: string): Promise<EncodeJob> {
  const response = await fetch(`${API_BASE}/queue/${id}/requeue`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "Only failed or canceled jobs can be requeued."
        : `Failed to requeue encode job (${response.status}).`
    );
  }
  return response.json() as Promise<EncodeJob>;
}

/** Removes all Completed/Canceled/Failed jobs; returns how many were removed. */
export async function clearFinishedEncodeJobs(): Promise<number> {
  const response = await fetch(`${API_BASE}/queue/finished`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(
      `Failed to clear finished encode jobs (${response.status}).`
    );
  }
  const result = (await response.json()) as { removed: number };
  return result.removed;
}

export function getEncodeQueueWsUrl(): string {
  return `${API_ORIGIN.replace(/^http/, "ws")}/api/encode/queue/ws`;
}
