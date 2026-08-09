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
 * Polling stops the instant the batch reaches a terminal state, so an idle
 * workspace makes no requests at all.
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
  // A ref, not state: the poll compares against it and would otherwise need
  // itself as a dependency.
  const settledCountRef = useRef(0);
  const settledCallbackRef = useRef(onJobsSettled);
  useEffect(() => {
    settledCallbackRef.current = onJobsSettled;
  });

  const poll = useCallback(async (signal?: AbortSignal) => {
    const latest = (await fetchJson("/api/application-batches/latest", {
      signal,
    })) as LatestResponse | null;
    if (!latest?.batchId) {
      settledCountRef.current = 0;
      setState(EMPTY);
      return;
    }

    const summary = (await fetchJson(
      `/api/application-batches/${latest.batchId}/summary`,
      { signal },
    )) as SummaryResponse | null;
    if (!summary) return;

    const { progress } = summary;
    const done = progress.succeeded + progress.failed;

    // Refresh the list whenever another job has landed, so its Saved CV/CL
    // appear without the user reloading.
    if (done > settledCountRef.current) {
      settledCountRef.current = done;
      settledCallbackRef.current();
    } else if (done < settledCountRef.current) {
      settledCountRef.current = done;
    }

    setState({
      batchId: summary.batch.id,
      status: summary.batch.status,
      done,
      total: summary.batch.totalCount,
      failed: progress.failed,
      active: !TERMINAL.has(summary.batch.status),
      failedJobIds: new Set(summary.failed.map((item) => item.jobId)),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        await poll(controller.signal);
      } catch {
        // A failed poll is not worth surfacing: the next one is 3s away and
        // the banner simply keeps its last known counts.
      }
      if (cancelled) return;
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  const refresh = useCallback(() => {
    void poll();
  }, [poll]);

  const dismiss = useCallback(() => {
    setDismissedBatchId(state.batchId);
  }, [state.batchId]);

  return {
    state,
    refresh,
    dismiss,
    /** Terminal batches stay visible until acknowledged, then go quiet. */
    visible:
      state.batchId !== null &&
      state.total > 0 &&
      state.batchId !== dismissedBatchId,
  };
}
