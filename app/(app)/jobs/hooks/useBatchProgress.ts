"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/fetchJson";

/**
 * Browser projection of the durable Application Batch.
 *
 * `watchBatch` is the important boundary: a successful create response already
 * owns the authoritative id/count, so the UI seeds QUEUED synchronously and
 * polls that exact batch. It never waits for `/latest` to catch up and a stale
 * discovery request cannot erase the newly-created batch.
 */

const POLL_MS = 3_000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"]);

export type BatchStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIAL"
  | "CANCELLED";

export type BatchSucceededItem = {
  taskId: string;
  jobId: string;
  jobTitle: string;
  company: string | null;
  completedAt: string;
  artifacts: {
    resumePdfUrl: string | null;
    coverPdfUrl: string | null;
  };
};

export type BatchFailedItem = {
  taskId: string;
  jobId: string;
  jobTitle: string;
  company: string | null;
  attempt: number;
  error: string;
  updatedAt: string;
};

export interface BatchProgressState {
  batchId: string | null;
  status: BatchStatus | null;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Every task that reached a terminal state, including skipped tasks. */
  done: number;
  total: number;
  active: boolean;
  pollUnavailable: boolean;
  succeededItems: readonly BatchSucceededItem[];
  failedItems: readonly BatchFailedItem[];
  failedJobIds: ReadonlySet<string>;
}

export type BatchWatchSeed = {
  id: string;
  status: BatchStatus;
  totalCount: number;
};

export type BatchActionProgress = {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped?: number;
};

const EMPTY: BatchProgressState = {
  batchId: null,
  status: null,
  pending: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  done: 0,
  total: 0,
  active: false,
  pollUnavailable: false,
  succeededItems: [],
  failedItems: [],
  failedJobIds: new Set(),
};

type LatestResponse = { batchId: string | null; status: BatchStatus | null };
type SummaryResponse = {
  batch: { id: string; status: BatchStatus; totalCount: number };
  progress: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    skipped?: number;
  };
  succeeded?: BatchSucceededItem[];
  failed?: BatchFailedItem[];
};

function stateFromSummary(summary: SummaryResponse): BatchProgressState {
  const skipped = summary.progress.skipped ?? 0;
  const done =
    summary.progress.succeeded + summary.progress.failed + skipped;
  const failedItems = summary.failed ?? [];
  return {
    batchId: summary.batch.id,
    status: summary.batch.status,
    pending: summary.progress.pending,
    running: summary.progress.running,
    succeeded: summary.progress.succeeded,
    failed: summary.progress.failed,
    skipped,
    done,
    total: summary.batch.totalCount,
    active: !TERMINAL.has(summary.batch.status),
    pollUnavailable: false,
    succeededItems: summary.succeeded ?? [],
    failedItems,
    failedJobIds: new Set(failedItems.map((item) => item.jobId)),
  };
}

export function useBatchProgress({
  onJobsSettled,
}: {
  onJobsSettled: () => void;
}) {
  const [state, setState] = useState<BatchProgressState>(EMPTY);
  const [dismissedBatchId, setDismissedBatchId] = useState<string | null>(null);
  const [watchedBatchIds, setWatchedBatchIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const settledCountRef = useRef(0);
  const settledBatchIdRef = useRef<string | null>(null);
  const settledCallbackRef = useRef(onJobsSettled);
  const batchIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    settledCallbackRef.current = onJobsSettled;
  });

  const stopPolling = useCallback(() => {
    epochRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const applySummary = useCallback((summary: SummaryResponse) => {
    const next = stateFromSummary(summary);
    batchIdRef.current = next.batchId;

    if (settledBatchIdRef.current !== next.batchId) {
      settledBatchIdRef.current = next.batchId;
      settledCountRef.current = 0;
    }
    if (next.done > settledCountRef.current) {
      settledCountRef.current = next.done;
      settledCallbackRef.current();
    } else if (next.done < settledCountRef.current) {
      settledCountRef.current = next.done;
    }

    if (next.active) {
      setWatchedBatchIds((previous) =>
        previous.has(summary.batch.id)
          ? previous
          : new Set(previous).add(summary.batch.id),
      );
    }
    setState(next);
    return next.active;
  }, []);

  const startPolling = useCallback(
    (preferredBatchId?: string | null) => {
      stopPolling();
      const epoch = epochRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;

      const tick = async () => {
        let batchId = preferredBatchId ?? batchIdRef.current;
        try {
          if (!batchId) {
            const latest = (await fetchJson("/api/application-batches/latest", {
              signal: controller.signal,
            })) as LatestResponse | null;
            if (controller.signal.aborted || epoch !== epochRef.current) return;
            batchId = latest?.batchId ?? null;
            if (!batchId) {
              batchIdRef.current = null;
              settledBatchIdRef.current = null;
              settledCountRef.current = 0;
              setState(EMPTY);
              return;
            }
          }

          const summary = (await fetchJson(
            `/api/application-batches/${batchId}/summary`,
            { signal: controller.signal },
          )) as SummaryResponse | null;
          if (controller.signal.aborted || epoch !== epochRef.current) return;
          if (!summary) throw new Error("Missing Application Batch summary");

          const active = applySummary(summary);
          if (!active) return;
        } catch {
          if (controller.signal.aborted || epoch !== epochRef.current) return;
          // A transient read failure says nothing about the durable batch.
          // Preserve the last known state and retry rather than silently
          // stopping the only progress feedback.
          setState((previous) => ({ ...previous, pollUnavailable: true }));
        }

        if (controller.signal.aborted || epoch !== epochRef.current) return;
        timerRef.current = setTimeout(tick, POLL_MS);
      };

      void tick();
    },
    [applySummary, stopPolling],
  );

  useEffect(() => {
    startPolling(null);
    return stopPolling;
  }, [startPolling, stopPolling]);

  const watchBatch = useCallback(
    (batch: BatchWatchSeed) => {
      batchIdRef.current = batch.id;
      settledBatchIdRef.current = batch.id;
      settledCountRef.current = 0;
      setDismissedBatchId(null);
      setWatchedBatchIds((previous) =>
        previous.has(batch.id) ? previous : new Set(previous).add(batch.id),
      );
      setState({
        ...EMPTY,
        batchId: batch.id,
        status: batch.status,
        pending: batch.status === "QUEUED" ? batch.totalCount : 0,
        running: batch.status === "RUNNING" ? 1 : 0,
        total: batch.totalCount,
        active: !TERMINAL.has(batch.status),
      });
      startPolling(batch.id);
    },
    [startPolling],
  );

  const refresh = useCallback(() => {
    startPolling(batchIdRef.current);
  }, [startPolling]);

  const applyBatchAction = useCallback(
    (result: { status: BatchStatus; progress: BatchActionProgress }) => {
      setState((previous) => {
        const skipped = result.progress.skipped ?? 0;
        return {
          ...previous,
          status: result.status,
          pending: result.progress.pending,
          running: result.progress.running,
          succeeded: result.progress.succeeded,
          failed: result.progress.failed,
          skipped,
          done: result.progress.succeeded + result.progress.failed + skipped,
          active: !TERMINAL.has(result.status),
          pollUnavailable: false,
        };
      });
      if (TERMINAL.has(result.status)) stopPolling();
    },
    [stopPolling],
  );

  const dismiss = useCallback(() => {
    setDismissedBatchId(state.batchId);
  }, [state.batchId]);

  return {
    state,
    refresh,
    watchBatch,
    applyBatchAction,
    dismiss,
    visible:
      state.batchId !== null &&
      state.total > 0 &&
      state.batchId !== dismissedBatchId &&
      (state.active || watchedBatchIds.has(state.batchId)),
  };
}
