"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { fetchJson } from "@/lib/api/fetchJson";
import {
  fitRunStartSchema,
  fitRunStatsSchema,
} from "@/lib/shared/schemas/fitScan";

/**
 * Fit scan control.
 *
 * The browser used to drive the model itself, batch by batch, through the
 * extension bridge. Scoring now belongs to the Runner, which drains the same
 * server-side queue against the user's local model. What is left here is
 * honest bookkeeping: enqueue the scan, then watch the server's counts.
 *
 * That means the queue can sit still — if no Runner is up, nothing drains it.
 * A stalled scan is reported as `waiting`, not as failure, because the work is
 * queued and a Runner started later will pick it up.
 */

const DEFAULT_POLL_MS = 3_000;
/** Polls without progress before the UI says it is waiting on a Runner. */
const STALL_POLLS = 3;

const fitRunCancellationSchema = fitRunStatsSchema
  .extend({
    cancelled: z.number().int().min(0),
    pending: z.literal(0),
  })
  .strict();

export type FitScanState = {
  status: "idle" | "scanning" | "done" | "failed";
  /** All NEW jobs in the database for this user. */
  total: number;
  /** Scored before this scan started (resume visibility). */
  alreadyScored: number;
  /** Scored by the Runner since this scan started. */
  scored: number;
  /** Cleared deterministically by the server's prescreen. */
  prescreened: number;
  /** Still waiting to be scored. */
  remaining: number;
  /** The queue has not moved for several polls — is a Runner running? */
  waiting: boolean;
  error?: string;
};

const IDLE: FitScanState = {
  status: "idle",
  total: 0,
  alreadyScored: 0,
  scored: 0,
  prescreened: 0,
  remaining: 0,
  waiting: false,
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function useFitScan(options: {
  onJobScored: () => void;
  /** Test seam; production polls every 3s. */
  pollMs?: number;
}) {
  const pollMs = Math.max(1, Math.floor(options.pollMs ?? DEFAULT_POLL_MS));
  const [state, setState] = useState<FitScanState>(IDLE);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const runRequestRef = useRef<Promise<unknown> | null>(null);
  const onJobScoredRef = useRef(options.onJobScored);

  useEffect(() => {
    onJobScoredRef.current = options.onJobScored;
  }, [options.onJobScored]);

  useEffect(
    () => () => {
      cancelRef.current = true;
      pollAbortRef.current?.abort();
    },
    [],
  );

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    const pollAbort = new AbortController();
    pollAbortRef.current = pollAbort;
    setState({ ...IDLE, status: "scanning" });

    try {
      const runRequest = fetchJson("/api/jobs/fit/run", {
        method: "POST",
        schema: fitRunStartSchema,
      });
      runRequestRef.current = runRequest;
      const run = await runRequest;
      if (runRequestRef.current === runRequest) runRequestRef.current = null;
      if (cancelRef.current) return;

      // Everything still pending after prescreen is this scan's workload.
      const workload = run.pending;
      const baseline = run.scored;
      setState((current) => ({
        ...current,
        total: run.total,
        alreadyScored: run.scored - run.prescreened,
        prescreened: run.prescreened,
        remaining: run.pending,
      }));
      if (run.prescreened > 0) onJobScoredRef.current();

      let lastPending = run.pending;
      let stalledPolls = 0;

      while (!cancelRef.current && workload > 0) {
        await sleep(pollMs, pollAbort.signal);
        if (cancelRef.current) break;

        const stats = await fetchJson("/api/jobs/fit/status", {
          schema: fitRunStatsSchema,
        });
        if (cancelRef.current) break;
        const progressed = stats.pending < lastPending;
        stalledPolls = progressed ? 0 : stalledPolls + 1;
        lastPending = stats.pending;

        setState((current) => ({
          ...current,
          total: stats.total,
          scored: Math.max(0, stats.scored - baseline),
          remaining: stats.pending,
          waiting: !progressed && stalledPolls >= STALL_POLLS,
        }));
        if (progressed) onJobScoredRef.current();

        if (stats.pending === 0) break;
      }

      if (!cancelRef.current) {
        setState((current) => ({
          ...current,
          status: "done",
          waiting: false,
        }));
      }
    } catch (error) {
      if (!cancelRef.current) {
        setState((current) => ({
          ...current,
          status: "failed",
          waiting: false,
          error: error instanceof Error ? error.message : "scan failed",
        }));
      }
    } finally {
      runRequestRef.current = null;
      if (pollAbortRef.current === pollAbort) pollAbortRef.current = null;
      runningRef.current = false;
    }
  }, [pollMs]);

  const stop = useCallback(async () => {
    if (!runningRef.current || cancelRef.current) return;
    cancelRef.current = true;
    pollAbortRef.current?.abort();

    const runRequest = runRequestRef.current;
    if (runRequest) {
      try {
        // A very fast Stop can race the initial Run request. Let Run finish
        // creating/resetting its queue before issuing the terminal cancel.
        await runRequest;
      } catch (error) {
        // `start` suppresses its own error after Stop sets the cancellation
        // flag, so Stop must surface a failed initial Run instead of leaving
        // the UI indefinitely in "scanning".
        setState((current) => ({
          ...current,
          status: "failed",
          waiting: false,
          error: error instanceof Error ? error.message : "scan failed",
        }));
        return;
      }
    }

    try {
      const result = await fetchJson("/api/jobs/fit/cancel", {
        method: "POST",
        schema: fitRunCancellationSchema,
        fallbackError: "Could not cancel Fit scan",
      });
      setState((current) => ({
        ...current,
        status: "idle",
        total: result.total,
        scored: result.scored,
        remaining: result.pending,
        waiting: false,
        error: undefined,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "failed",
        waiting: false,
        error:
          error instanceof Error ? error.message : "Could not cancel Fit scan",
      }));
    }
  }, []);

  const reset = useCallback(() => {
    if (!runningRef.current) setState(IDLE);
  }, []);

  return { state, start, stop, reset };
}
