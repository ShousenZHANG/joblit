"use client";

import { useCallback, useRef, useState } from "react";

import { LocalAiBridgeError, sendLocalAiBridgeRequest } from "@/lib/client/localAiBridge";
import { fetchJson } from "@/lib/api/fetchJson";

const FIT_POLL_MS = 1_500;
const DEFAULT_LEASE_POLL_MS = 5_000;
const MAX_LEASE_POLL_MS = 30_000;
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
  /** Pending jobs currently owned by another fresh scan lease. */
  leased: number;
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
  leased: 0,
};

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : fallback;
}

function waitForLeasePoll(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Every fit call goes through the shared helper, so a failure arrives as an
 * `ApiError` carrying the server's code and message. This module used to own a
 * private copy that threw `new Error("<url> failed: <status>")`, which put a
 * URL and a status code in front of the user and hid the fit surface from the
 * error handling the rest of the workspace relies on.
 */
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  return (await fetchJson<undefined>(url, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })) as T;
}

async function importTriageResult(
  jobIds: string[],
  claimToken: string,
  modelOutput: string,
  promptMeta: Record<string, unknown>,
): Promise<number> {
  const json = await postJson<{ scored?: Array<{ jobId: string }> }>(
    "/api/jobs/fit/batch-import",
    { jobIds, claimToken, modelOutput, promptMeta },
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
  claimToken: string,
  isCancelled: () => boolean,
  retryBackoffMs: number,
  pollMs: number,
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
          return importTriageResult(jobIds, claimToken, run.modelOutput, run.promptMeta);
        }
        if (run.status === "failed") throw new Error(run.error.code);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const run = await sendLocalAiBridgeRequest(
        "GET_RUN",
        { requestId },
        { timeoutMs: 10_000 },
      );
      if (run.status === "succeeded") {
        return importTriageResult(jobIds, claimToken, run.modelOutput, run.promptMeta);
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
      // The extension raises HERMES_RUN_NOT_FOUND internally but rewrites it to
      // RUN_LOST before the response crosses the bridge, so RUN_LOST is the only
      // code the web side can ever observe for a forgotten run.
      if (started && error instanceof LocalAiBridgeError && error.code === "RUN_LOST") {
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
export function useFitScan(options: {
  onJobScored: () => void;
  retryBackoffMs?: number;
  /** Test seam; production never polls a live lease more often than every 5s. */
  leasePollMinMs?: number;
  /** Test seam; production polls a live run every 1.5s. */
  pollMs?: number;
}) {
  const retryBackoffMs = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const pollMs = Math.max(1, Math.floor(options.pollMs ?? FIT_POLL_MS));
  const leasePollMinMs = Math.max(
    1,
    Math.floor(options.leasePollMinMs ?? DEFAULT_LEASE_POLL_MS),
  );
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
        const batch = await postJson<{
          jobIds: string[];
          remaining: number;
          pendingTotal?: number;
          leased?: number;
          retryAfterMs?: number | null;
          claimToken: string | null;
        }>(
          "/api/jobs/fit/next-batch",
        );
        if (batch.jobIds.length === 0) {
          // Empty does not necessarily mean done: another tab or a browser
          // session that just closed may still own fresh leases. Keep this scan
          // in recovery mode and poll at the server-provided low frequency.
          const pendingTotal = nonNegativeInteger(
            batch.pendingTotal,
            nonNegativeInteger(batch.remaining),
          );
          const leased = nonNegativeInteger(batch.leased);
          if (pendingTotal > 0 || leased > 0) {
            const requestedDelay = nonNegativeInteger(
              batch.retryAfterMs,
              leasePollMinMs,
            );
            const waitMs = Math.min(
              MAX_LEASE_POLL_MS,
              Math.max(leasePollMinMs, requestedDelay),
            );
            setState((current) => ({
              ...current,
              remaining: Math.max(pendingTotal, leased),
              leased,
            }));
            await waitForLeasePoll(waitMs);
            continue;
          }
          setState((current) => ({ ...current, remaining: 0, leased: 0 }));
          break;
        }
        if (!batch.claimToken) throw new Error("Scoring batch claim is missing");
        const remaining = nonNegativeInteger(batch.remaining);
        const leasedByOtherScans = Math.max(
          nonNegativeInteger(batch.leased) - batch.jobIds.length,
          0,
        );
        setState((current) => ({
          ...current,
          remaining: remaining + batch.jobIds.length,
          leased: leasedByOtherScans,
        }));
        try {
          const scored = await runTriageBatch(
            batch.jobIds,
            batch.claimToken,
            () => cancelRef.current,
            retryBackoffMs,
            pollMs,
          );
          const failed = batch.jobIds.length - scored;
          if (failed > 0) {
            await postJson("/api/jobs/fit/mark-failed", {
              jobIds: batch.jobIds,
              claimToken: batch.claimToken,
            }).catch(() => undefined);
          }
          setState((current) => ({
            ...current,
            scored: current.scored + scored,
            failed: current.failed + failed,
            remaining,
            leased: leasedByOtherScans,
          }));
          onJobScoredRef.current();
        } catch (error) {
          if (cancelRef.current) {
            await postJson("/api/jobs/fit/release-batch", {
              jobIds: batch.jobIds,
              claimToken: batch.claimToken,
            }).catch(() => undefined);
            break;
          }
          void error;
          // Terminal batch failure: dequeue so the pump never loops on it.
          await postJson("/api/jobs/fit/mark-failed", {
            jobIds: batch.jobIds,
            claimToken: batch.claimToken,
          }).catch(() => undefined);
          setState((current) => ({
            ...current,
            failed: current.failed + batch.jobIds.length,
            remaining,
            leased: leasedByOtherScans,
          }));
        }
      }
      setState((current) => ({
        ...current,
        status: cancelRef.current ? "idle" : "done",
        leased: 0,
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
  }, [leasePollMinMs, pollMs, retryBackoffMs]);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    if (!runningRef.current) setState(IDLE);
  }, []);

  return { state, start, stop, reset };
}
