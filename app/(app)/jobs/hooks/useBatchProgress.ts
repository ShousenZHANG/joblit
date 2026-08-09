"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/fetchJson";

/**
 * Live view of the generation batch the Runner is working through.
 *
 * Clicking Generate used to end the story: a toast said "queued" and then
 * nothing moved until the user reloaded and guessed. The counts already
 * existed server-side — this polls them so the page can say what is actually
 * happening, and refreshes the list the moment a job finishes so its PDFs
 * appear on their own.
 *
 * Polling is not a heartbeat. It checks once on mount, keeps going only while
 * a batch is genuinely unfinished, and stops the moment one settles. An idle
 * workspace therefore makes exactly one request and then goes quiet — which
 * is also what keeps this hook out of the way of tests that drive their own
 * timers.
 */

const POLL_MS = 3_000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"]);

export interface BatchProgressState {
  batchId: string | null;
  status: string | null;
  /** Tasks that have reached a terminal state, successful or not. */
  done: number;
  total: number;
  failed: number;
  /** True while the batch still has work the Runner can claim. */
  active: boolean;
  /**
   * Jobs this batch could not generate. The summary reports which tasks
   * succeeded or failed but not which one is in flight, so there is
   * deliberately no "currently generating" row marker — a spinner on a guessed
   * row would be worse than none.
   */
  failedJobIds: ReadonlySet<string>;
}

const EMPTY: BatchProgressState = {
  batchId: null,
  status: null,
  done: 0,
  total: 0,
  failed: 0,
  active: false,
  failedJobIds: new Set(),
};

type LatestResponse = { batchId: string | null; status: string | null };
type SummaryResponse = {
  batch: { id: string; status: string; totalCount: number };
  progress: { pending: number; running: number; succeeded: number; failed: number };
  succeeded: Array<{ jobId: string }>;
  failed: Array<{ jobId: string }>;
};

export function useBatchProgress({
  onJobsSettled,
}: {
  /** Called when the set of finished jobs grows, so the list can refetch. */
  onJobsSettled: () => void;
}) {
  const [state, setState] = useState<BatchProgressState>(EMPTY);
  const [dismissedBatchId, setDismissedBatchId] = useState<string | null>(null);
  /**
   * Batches watched from unfinished to finished in this session. A batch that
   * was already complete when the page loaded is history, not news, so the
   * banner stays silent about it.
   */
  const [watchedBatchIds, setWatchedBatchIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Refs, not state: the poll compares against these and would otherwise need
  // itself as a dependency.
  const settledCountRef = useRef(0);
  const settledCallbackRef = useRef(onJobsSettled);
  useEffect(() => {
    settledCallbackRef.current = onJobsSettled;
  });

  /** Resolves true while the batch still has work, so the caller can decide
   *  whether another poll is worth scheduling. */
  const poll = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const latest = (await fetchJson("/api/application-batches/latest", {
      signal,
    })) as LatestResponse | null;
    if (!latest?.batchId) {
      settledCountRef.current = 0;
      setState(EMPTY);
      return false;
    }

    const summary = (await fetchJson(
      `/api/application-batches/${latest.batchId}/summary`,
      { signal },
    )) as SummaryResponse | null;
    if (!summary) return false;

    const { progress } = summary;
    const done = progress.succeeded + progress.failed;
    const active = !TERMINAL.has(summary.batch.status);

    // Refresh the list whenever another job has landed, so its Saved CV/CL
    // appear without the user reloading.
    if (done > settledCountRef.current) {
      settledCountRef.current = done;
      settledCallbackRef.current();
    } else if (done < settledCountRef.current) {
      settledCountRef.current = done;
    }

    if (active) {
      setWatchedBatchIds((prev) =>
        prev.has(summary.batch.id) ? prev : new Set(prev).add(summary.batch.id),
      );
    }

    setState({
      batchId: summary.batch.id,
      status: summary.batch.status,
      done,
      total: summary.batch.totalCount,
      failed: progress.failed,
      active,
      failedJobIds: new Set(summary.failed.map((item) => item.jobId)),
    });
    return active;
  }, []);

  // One live poll chain at a time, restartable by `refresh`.
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const startPolling = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;

    const tick = async () => {
      let keepGoing = false;
      try {
        keepGoing = await poll(controller.signal);
      } catch {
        // A failed poll is not worth surfacing; the banner keeps its last
        // known counts and the chain simply ends.
      }
      if (controller.signal.aborted) {
        runningRef.current = false;
        return;
      }
      if (!keepGoing) {
        runningRef.current = false;
        return;
      }
      timerRef.current = setTimeout(tick, POLL_MS);
    };
    void tick();
  }, [poll]);

  useEffect(() => {
    startPolling();
    return () => {
      controllerRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      runningRef.current = false;
    };
  }, [startPolling]);

  /** Called right after queueing, to pick the new batch up immediately. */
  const refresh = useCallback(() => {
    startPolling();
  }, [startPolling]);

  const dismiss = useCallback(() => {
    setDismissedBatchId(state.batchId);
  }, [state.batchId]);

  return {
    state,
    refresh,
    dismiss,
    /**
     * Visible while a batch runs, and afterwards until acknowledged — but only
     * for batches this session actually watched run. A finished batch from
     * yesterday is not news to announce on page load.
     */
    visible:
      state.batchId !== null &&
      state.total > 0 &&
      state.batchId !== dismissedBatchId &&
      (state.active || watchedBatchIds.has(state.batchId)),
  };
}
