"use client";

import { useCallback, useRef, useState } from "react";

import { sendLocalAiBridgeRequest } from "@/lib/client/localAiBridge";

const FIT_POLL_MS = 1_000;
// Match runs judge 6-14 requirements one by one on a local reasoning model —
// measured ~157s on a real JD. Background batch work, so the budget is looser
// than the interactive CV/cover budget.
const FIT_RUN_BUDGET_MS = 240_000;

export type FitScanState = {
  status: "idle" | "scanning" | "done" | "failed";
  total: number;
  scored: number;
  prescreened: number;
  failed: number;
  currentJobId: string | null;
  error?: string;
};

const IDLE: FitScanState = {
  status: "idle",
  total: 0,
  scored: 0,
  prescreened: 0,
  failed: 0,
  currentJobId: null,
};

async function importFitResult(jobId: string, modelOutput: string, promptMeta: Record<string, unknown>) {
  const response = await fetch(`/api/jobs/${jobId}/fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelOutput, promptMeta }),
  });
  if (!response.ok) throw new Error(`fit import failed: ${response.status}`);
}

async function runMatchForJob(jobId: string, isCancelled: () => boolean): Promise<void> {
  const requestId = crypto.randomUUID();
  const started = await sendLocalAiBridgeRequest(
    "START_RUN",
    { requestId, jobId, target: "match" },
    { timeoutMs: 20_000 },
  );
  if (started.status === "succeeded") {
    await importFitResult(jobId, started.modelOutput, started.promptMeta);
    return;
  }
  const deadline = Date.now() + FIT_RUN_BUDGET_MS;
  for (;;) {
    if (isCancelled()) {
      await sendLocalAiBridgeRequest("STOP_RUN", { requestId }).catch(() => undefined);
      throw new Error("cancelled");
    }
    if (Date.now() > deadline) {
      await sendLocalAiBridgeRequest("STOP_RUN", { requestId }).catch(() => undefined);
      throw new Error("run timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, FIT_POLL_MS));
    const run = await sendLocalAiBridgeRequest(
      "GET_RUN",
      { requestId },
      { timeoutMs: 10_000 },
    );
    if (run.status === "succeeded") {
      await importFitResult(jobId, run.modelOutput, run.promptMeta);
      return;
    }
    if (run.status === "failed") throw new Error(run.error.code);
    if (run.status === "cancelled") throw new Error("cancelled");
  }
}

/**
 * Sequential job-fit scan: deterministic prescreen first (one request), then
 * one local Hermes "match" run per remaining job. Serial by design — the local
 * gateway executes one run at a time. Already-scored jobs are skipped by the
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
      setState((current) => ({ ...current, prescreened: prescreen.poor.length }));
      if (prescreen.poor.length > 0) onJobScoredRef.current();

      for (const jobId of prescreen.needAi) {
        if (cancelRef.current) break;
        setState((current) => ({ ...current, currentJobId: jobId }));
        try {
          await runMatchForJob(jobId, () => cancelRef.current);
          setState((current) => ({ ...current, scored: current.scored + 1 }));
          onJobScoredRef.current();
        } catch (error) {
          if (cancelRef.current) break;
          void error;
          setState((current) => ({ ...current, failed: current.failed + 1 }));
        }
      }
      setState((current) => ({
        ...current,
        status: cancelRef.current ? "idle" : "done",
        currentJobId: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "failed",
        currentJobId: null,
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
