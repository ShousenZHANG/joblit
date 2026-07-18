"use client";

import { useCallback, useRef, useState } from "react";

import { LocalAiBridgeError, sendLocalAiBridgeRequest } from "@/lib/client/localAiBridge";

const FIT_POLL_MS = 1_500;
// Backoff between retries of a retryable bridge failure (rate limit, cold
// service worker, transient not-found while the run is still being created).
const RETRY_BACKOFF_MS = 8_000;
// One triage run scores a whole batch of jobs coarsely on the local reasoning
// model — measured ~27s per batch on "low" effort, but budget generously.
const TRIAGE_RUN_BUDGET_MS = 240_000;

/** Bridge errors that mean "wait and ask again", not "the batch is lost". */
function isRetryableBridgeError(error: unknown): boolean {
  return error instanceof LocalAiBridgeError && error.retryable;
}

export type FitScanState = {
  status: "idle" | "scanning" | "done" | "failed";
  /** All NEW jobs in the database for this user. */
  total: number;
  /** Scored before this scan started (resume visibility). */
  alreadyScored: number;
  scored: number;
  prescreened: number;
  failed: number;
  remaining: number;
  error?: string;
};

const IDLE: FitScanState = {
  status: "idle",
  total: 0,
  alreadyScored: 0,
  scored: 0,
  prescreened: 0,
  failed: 0,
  remaining: 0,
};

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

async function importTriageResult(
  jobIds: string[],
  modelOutput: string,
  promptMeta: Record<string, unknown>,
): Promise<number> {
  const json = await postJson<{ scored?: Array<{ jobId: string }> }>(
    "/api/jobs/fit/batch-import",
    { jobIds, modelOutput, promptMeta },
  );
  return json.scored?.length ?? 0;
}

/**
 * Drive one triage batch to completion. START_RUN is idempotent per requestId
 * on the service-worker side, so retryable failures (rate limit, cold worker,
 * a GET_RUN racing the run's creation) wait and retry the SAME requestId
 * instead of abandoning the batch and orphaning the Hermes run.
 */
async function runTriageBatch(
  jobIds: string[],
  isCancelled: () => boolean,
  retryBackoffMs: number,
): Promise<number> {
  const requestId = crypto.randomUUID();
  const deadline = Date.now() + TRIAGE_RUN_BUDGET_MS;
  let started = false;
  let notFoundStreak = 0;
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
      // A requestId the worker no longer knows (worker restart) cannot recover
      // by polling; after a few consecutive not-found polls start fresh.
      if (started && error instanceof LocalAiBridgeError && error.code === "HERMES_RUN_NOT_FOUND") {
        notFoundStreak += 1;
        if (notFoundStreak >= 3) {
          started = false;
          notFoundStreak = 0;
        }
      } else {
        notFoundStreak = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, retryBackoffMs));
    }
  }
}

/**
 * Full-database fit scan pump. The database is the queue: the server
 * prescreens every unscored NEW job, then hands out batches of unscored ids
 * until none remain. Nothing is kept client-side — a refresh mid-scan loses
 * nothing, and pressing the button again simply resumes from the database.
 */
export function useFitScan(options: { onJobScored: () => void; retryBackoffMs?: number }) {
  const retryBackoffMs = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const [state, setState] = useState<FitScanState>(IDLE);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const onJobScoredRef = useRef(options.onJobScored);
  onJobScoredRef.current = options.onJobScored;

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setState({ ...IDLE, status: "scanning" });
    try {
      const run = await postJson<{
        total: number;
        scored: number;
        pending: number;
        prescreened: number;
      }>("/api/jobs/fit/run");
      setState((current) => ({
        ...current,
        total: run.total,
        alreadyScored: run.scored - run.prescreened,
        prescreened: run.prescreened,
        remaining: run.pending,
      }));
      if (run.prescreened > 0) onJobScoredRef.current();

      for (;;) {
        if (cancelRef.current) break;
        const batch = await postJson<{ jobIds: string[]; remaining: number }>(
          "/api/jobs/fit/next-batch",
        );
        if (batch.jobIds.length === 0) break;
        setState((current) => ({ ...current, remaining: batch.remaining + batch.jobIds.length }));
        try {
          const scored = await runTriageBatch(batch.jobIds, () => cancelRef.current, retryBackoffMs);
          const failed = batch.jobIds.length - scored;
          if (failed > 0) {
            await postJson("/api/jobs/fit/mark-failed", { jobIds: batch.jobIds }).catch(() => undefined);
          }
          setState((current) => ({
            ...current,
            scored: current.scored + scored,
            failed: current.failed + failed,
            remaining: batch.remaining,
          }));
          onJobScoredRef.current();
        } catch (error) {
          if (cancelRef.current) break;
          void error;
          // Terminal batch failure: dequeue so the pump never loops on it.
          await postJson("/api/jobs/fit/mark-failed", { jobIds: batch.jobIds }).catch(() => undefined);
          setState((current) => ({
            ...current,
            failed: current.failed + batch.jobIds.length,
            remaining: batch.remaining,
          }));
        }
      }
      setState((current) => ({
        ...current,
        status: cancelRef.current ? "idle" : "done",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "scan failed",
      }));
    } finally {
      runningRef.current = false;
    }
  }, [retryBackoffMs]);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    if (!runningRef.current) setState(IDLE);
  }, []);

  return { state, start, stop, reset };
}
