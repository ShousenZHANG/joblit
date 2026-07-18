"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LocalAiBridgeError, sendLocalAiBridgeRequest } from "@/lib/client/localAiBridge";

const FIT_POLL_MS = 1_500;
// Backoff between retries of a retryable bridge failure (rate limit, cold
// service worker, transient not-found while the run is still being created).
const RETRY_BACKOFF_MS = 8_000;
// One triage run scores a whole batch of jobs coarsely on the local reasoning
// model — measured ~27s per 10-job batch, but budget generously.
const TRIAGE_RUN_BUDGET_MS = 240_000;
const TRIAGE_BATCH_SIZE = 15;
export const FIT_SCAN_STORAGE_KEY = "joblit.fit-scan.v1";

/** Bridge errors that mean "wait and ask again", not "the batch is lost". */
function isRetryableBridgeError(error: unknown): boolean {
  return error instanceof LocalAiBridgeError && error.retryable;
}

export type FitScanState = {
  status: "idle" | "scanning" | "done" | "failed";
  total: number;
  scored: number;
  prescreened: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
  error?: string;
};

const IDLE: FitScanState = {
  status: "idle",
  total: 0,
  scored: 0,
  prescreened: 0,
  failed: 0,
  currentBatch: 0,
  totalBatches: 0,
};

type PersistedScan = {
  /** Active run for the batch currently executing (resume target). */
  requestId: string;
  batchJobIds: string[];
  /** Batches not yet started. */
  remaining: string[][];
  scored: number;
  prescreened: number;
  failed: number;
  total: number;
  totalBatches: number;
  currentBatch: number;
};

function readPersisted(): PersistedScan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(FIT_SCAN_STORAGE_KEY) ?? "null");
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.requestId === "string" &&
      Array.isArray(raw.batchJobIds) &&
      Array.isArray(raw.remaining)
    ) {
      return raw as PersistedScan;
    }
  } catch {
    // Corrupt snapshot: fall through to null.
  }
  return null;
}

function persist(snapshot: PersistedScan | null): void {
  if (typeof window === "undefined") return;
  if (snapshot === null) {
    window.sessionStorage.removeItem(FIT_SCAN_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(FIT_SCAN_STORAGE_KEY, JSON.stringify(snapshot));
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function importTriageResult(
  jobIds: string[],
  modelOutput: string,
  promptMeta: Record<string, unknown>,
): Promise<number> {
  const response = await fetch("/api/jobs/fit/batch-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobIds, modelOutput, promptMeta }),
  });
  if (!response.ok) throw new Error(`batch import failed: ${response.status}`);
  const json = (await response.json()) as { scored?: Array<{ jobId: string }> };
  return json.scored?.length ?? 0;
}

/**
 * Drive one triage batch to completion. START_RUN is idempotent per requestId
 * on the service-worker side, so retryable failures (rate limit, cold worker,
 * a GET_RUN racing the run's creation) wait and retry the SAME requestId
 * instead of abandoning the batch and orphaning the Hermes run.
 */
async function runTriageBatch(
  requestId: string,
  jobIds: string[],
  isCancelled: () => boolean,
  retryBackoffMs: number = RETRY_BACKOFF_MS,
): Promise<number> {
  const deadline = Date.now() + TRIAGE_RUN_BUDGET_MS;
  let started = false;
  for (;;) {
    if (isCancelled() || Date.now() > deadline) {
      await sendLocalAiBridgeRequest("STOP_RUN", { requestId }).catch(() => undefined);
      throw new Error(isCancelled() ? "cancelled" : "run timed out");
    }
    try {
      if (!started) {
        const run = await sendLocalAiBridgeRequest(
          "START_RUN",
          { requestId, jobId: jobIds[0], target: "triage", jobIds },
          { timeoutMs: 20_000 },
        );
        started = true;
        if (run.status === "succeeded") {
          return importTriageResult(jobIds, run.modelOutput, run.promptMeta);
        }
        if (run.status === "failed") throw new Error(run.error.code);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, FIT_POLL_MS));
      const run = await sendLocalAiBridgeRequest(
        "GET_RUN",
        { requestId },
        { timeoutMs: 10_000 },
      );
      if (run.status === "succeeded") {
        return importTriageResult(jobIds, run.modelOutput, run.promptMeta);
      }
      if (run.status === "failed") throw new Error(run.error.code);
      if (run.status === "cancelled") throw new Error("cancelled");
    } catch (error) {
      if (!isRetryableBridgeError(error)) throw error;
      // BRIDGE_TIMEOUT on START_RUN is ambiguous: the worker may have created
      // the run anyway; from here on GET_RUN (idempotent) takes over.
      if (!started && error instanceof LocalAiBridgeError && error.code === "BRIDGE_TIMEOUT") {
        started = true;
      }
      await new Promise((resolve) => setTimeout(resolve, retryBackoffMs));
    }
  }
}

/**
 * Batch fit scan: deterministic prescreen first, then one local Hermes triage
 * run per batch of up to 15 jobs. Progress survives a page refresh: the active
 * run + remaining batches persist in sessionStorage and resume on mount, so a
 * run that finishes while the page reloads still gets imported.
 */
export function useFitScan(options: { onJobScored: () => void; retryBackoffMs?: number }) {
  const retryBackoffMs = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const [state, setState] = useState<FitScanState>(IDLE);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const onJobScoredRef = useRef(options.onJobScored);
  onJobScoredRef.current = options.onJobScored;

  const executeBatches = useCallback(
    async (
      firstBatch: { requestId: string | null; jobIds: string[] } | null,
      remaining: string[][],
      base: Pick<PersistedScan, "scored" | "prescreened" | "failed" | "total" | "totalBatches" | "currentBatch">,
    ) => {
      let { scored, failed, currentBatch } = base;
      const queue: Array<{ requestId: string; jobIds: string[] }> = [
        ...(firstBatch ? [{ requestId: firstBatch.requestId ?? crypto.randomUUID(), jobIds: firstBatch.jobIds }] : []),
        ...remaining.map((jobIds) => ({ requestId: crypto.randomUUID(), jobIds })),
      ];
      for (const [index, batch] of queue.entries()) {
        if (cancelRef.current) break;
        currentBatch = base.currentBatch + index;
        setState((current) => ({ ...current, currentBatch }));
        persist({
          requestId: batch.requestId,
          batchJobIds: batch.jobIds,
          remaining: queue.slice(index + 1).map((entry) => entry.jobIds),
          scored,
          prescreened: base.prescreened,
          failed,
          total: base.total,
          totalBatches: base.totalBatches,
          currentBatch,
        });
        try {
          const count = await runTriageBatch(batch.requestId, batch.jobIds, () => cancelRef.current, retryBackoffMs);
          scored += count;
          failed += batch.jobIds.length - count;
          setState((current) => ({ ...current, scored, failed }));
          onJobScoredRef.current();
        } catch (error) {
          if (cancelRef.current) break;
          void error;
          failed += batch.jobIds.length;
          setState((current) => ({ ...current, failed }));
        }
      }
      persist(null);
      setState((current) => ({
        ...current,
        status: cancelRef.current ? "idle" : "done",
        currentBatch: 0,
      }));
    },
    [retryBackoffMs],
  );

  const start = useCallback(async (jobIds: string[]) => {
    if (runningRef.current || jobIds.length === 0) return;
    runningRef.current = true;
    cancelRef.current = false;
    setState({ ...IDLE, status: "scanning", total: jobIds.length });
    try {
      const prescreenResponse = await fetch("/api/jobs/fit/prescreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds }),
      });
      if (!prescreenResponse.ok) {
        throw new Error(`prescreen failed: ${prescreenResponse.status}`);
      }
      const prescreen = (await prescreenResponse.json()) as {
        poor: Array<{ jobId: string }>;
        needAi: string[];
      };
      const batches = chunk(prescreen.needAi, TRIAGE_BATCH_SIZE);
      setState((current) => ({
        ...current,
        prescreened: prescreen.poor.length,
        totalBatches: batches.length,
      }));
      if (prescreen.poor.length > 0) onJobScoredRef.current();
      await executeBatches(null, batches, {
        scored: 0,
        prescreened: prescreen.poor.length,
        failed: 0,
        total: jobIds.length,
        totalBatches: batches.length,
        currentBatch: 1,
      });
    } catch (error) {
      persist(null);
      setState((current) => ({
        ...current,
        status: "failed",
        currentBatch: 0,
        error: error instanceof Error ? error.message : "scan failed",
      }));
    } finally {
      runningRef.current = false;
    }
  }, [executeBatches]);

  // Resume a scan interrupted by a refresh: pick up the in-flight run first,
  // then continue with any batches that never started.
  useEffect(() => {
    const persisted = readPersisted();
    if (!persisted || runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setState({
      status: "scanning",
      total: persisted.total,
      scored: persisted.scored,
      prescreened: persisted.prescreened,
      failed: persisted.failed,
      currentBatch: persisted.currentBatch,
      totalBatches: persisted.totalBatches,
    });
    void executeBatches(
      { requestId: persisted.requestId, jobIds: persisted.batchJobIds },
      persisted.remaining,
      persisted,
    )
      .catch(() => {
        persist(null);
        setState((current) => ({ ...current, status: "failed", currentBatch: 0 }));
      })
      .finally(() => {
        runningRef.current = false;
      });
  }, [executeBatches]);

  const stop = useCallback(() => {
    cancelRef.current = true;
    persist(null);
  }, []);

  const reset = useCallback(() => {
    if (!runningRef.current) setState(IDLE);
  }, []);

  return { state, start, stop, reset };
}
