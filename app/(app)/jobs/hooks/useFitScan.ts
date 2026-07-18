"use client";

import { useCallback, useRef, useState } from "react";

import { sendLocalAiBridgeRequest } from "@/lib/client/localAiBridge";

const FIT_POLL_MS = 1_000;
// One triage run scores a whole batch of jobs coarsely on the local reasoning
// model — measured minutes-scale, so the budget is looser than interactive runs.
const TRIAGE_RUN_BUDGET_MS = 240_000;
const TRIAGE_BATCH_SIZE = 15;

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

async function runTriageBatch(
  jobIds: string[],
  isCancelled: () => boolean,
): Promise<number> {
  const requestId = crypto.randomUUID();
  const started = await sendLocalAiBridgeRequest(
    "START_RUN",
    { requestId, jobId: jobIds[0], target: "triage", jobIds },
    { timeoutMs: 20_000 },
  );
  if (started.status === "succeeded") {
    return importTriageResult(jobIds, started.modelOutput, started.promptMeta);
  }
  const deadline = Date.now() + TRIAGE_RUN_BUDGET_MS;
  for (;;) {
    if (isCancelled() || Date.now() > deadline) {
      await sendLocalAiBridgeRequest("STOP_RUN", { requestId }).catch(() => undefined);
      throw new Error(isCancelled() ? "cancelled" : "run timed out");
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
  }
}

/**
 * Batch fit scan: deterministic prescreen first (one request), then one local
 * Hermes triage run per batch of up to 15 jobs. Serial by design — the local
 * gateway runs one job at a time. Already-scored jobs are skipped by the
 * caller, so the scan is naturally resumable.
 */
export function useFitScan(options: { onJobScored: () => void }) {
  const [state, setState] = useState<FitScanState>(IDLE);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const onJobScoredRef = useRef(options.onJobScored);
  onJobScoredRef.current = options.onJobScored;

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

      for (const [index, batch] of batches.entries()) {
        if (cancelRef.current) break;
        setState((current) => ({ ...current, currentBatch: index + 1 }));
        try {
          const scored = await runTriageBatch(batch, () => cancelRef.current);
          setState((current) => ({
            ...current,
            scored: current.scored + scored,
            failed: current.failed + (batch.length - scored),
          }));
          onJobScoredRef.current();
        } catch (error) {
          if (cancelRef.current) break;
          void error;
          setState((current) => ({ ...current, failed: current.failed + batch.length }));
        }
      }
      setState((current) => ({
        ...current,
        status: cancelRef.current ? "idle" : "done",
        currentBatch: 0,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "failed",
        currentBatch: 0,
        error: error instanceof Error ? error.message : "scan failed",
      }));
    } finally {
      runningRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    if (!runningRef.current) setState(IDLE);
  }, []);

  return { state, start, stop, reset };
}
