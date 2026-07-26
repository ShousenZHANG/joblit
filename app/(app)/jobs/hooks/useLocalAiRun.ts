"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  detectLocalAiAvailability,
  LocalAiBridgeError,
  sendLocalAiBridgeRequest,
  type LocalAiDetectionState,
} from "@/lib/client/localAiBridge";
import {
  LOCAL_AI_MAX_REPAIR_FEEDBACK_CHARS,
  type LocalAiPublicRun,
  type LocalAiSucceededRun,
} from "@/lib/shared/localAiBridgeContract";
import { DraftImportError } from "./useExternalGenerate";
import { fetchJson } from "@/lib/api/fetchJson";
import type { TailoringRunHandle } from "@/lib/shared/tailoringRunContract";

export const LOCAL_AI_ACTIVE_REQUEST_KEY = "joblit.local-ai.active-request.v1";
export const LOCAL_AI_LAST_START_KEY = "joblit.local-ai.last-start.v1";
export const LOCAL_AI_POLL_MS = 750;
// Total wall-clock budget for a single run. A run that never reaches a terminal
// state (e.g. the local model stalls or ChatGPT auth is not active) must not
// spin forever — spec §14.1 / §17 require a bounded total timeout.
export const LOCAL_AI_MAX_RUN_MS = 180_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LastStart = { jobId: string; target: "resume" | "cover" };
type DurableRunStatus =
  | "ISSUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "PARTIAL";

export type LocalAiAvailability =
  | "detecting"
  | LocalAiDetectionState;

export type LocalAiRunState =
  | { status: "idle" }
  | { status: "starting"; requestId: string; jobId: string; target: "resume" | "cover" }
  | {
      status: "queued" | "running" | "stopping";
      requestId: string;
      jobId?: string;
      target?: "resume" | "cover";
      tailoringRun?: TailoringRunHandle;
      progressChars?: number;
    }
  | {
      status: "importing";
      requestId: string;
      jobId: string;
      target: "resume" | "cover";
      tailoringRun?: TailoringRunHandle;
    }
  | {
      status: "succeeded";
      requestId: string;
      jobId: string;
      target: "resume" | "cover";
      tailoringRun?: TailoringRunHandle;
    }
  | {
      status: "cancelled";
      requestId: string;
      jobId: string;
      target: "resume" | "cover";
      tailoringRun?: TailoringRunHandle;
    }
  | {
      status: "failed";
      requestId?: string;
      jobId?: string;
      target?: "resume" | "cover";
      tailoringRun?: TailoringRunHandle;
      error: { code: string; retryable: boolean };
    };

function restoredRequestId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY);
  return value && UUID_RE.test(value) ? value : null;
}

function restoredLastStart(): LastStart | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(LOCAL_AI_LAST_START_KEY) ?? "null");
    return (
      value &&
      typeof value === "object" &&
      UUID_RE.test(value.jobId) &&
      (value.target === "resume" || value.target === "cover")
    )
      ? { jobId: value.jobId, target: value.target }
      : null;
  } catch {
    return null;
  }
}

function bridgeFailure(error: unknown, fallbackCode: string) {
  return error instanceof LocalAiBridgeError
    ? { code: error.code, retryable: error.retryable }
    : { code: fallbackCode, retryable: true };
}

/** Flatten validator output into a bounded, control-character-free line. */
function repairFeedbackFromError(error: DraftImportError): string {
  const text = (error.details.length ? error.details.join("; ") : error.message)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim();
  return (text || "The JSON did not match the required schema.").slice(
    0,
    LOCAL_AI_MAX_REPAIR_FEEDBACK_CHARS,
  );
}

async function failDurableRun(
  handle: TailoringRunHandle,
  code: string,
): Promise<DurableRunStatus> {
  const result = await fetchJson(`/api/tailoring-runs/${handle.id}/fail`, {
    method: "POST",
    body: JSON.stringify({ attemptId: handle.attemptId, code }),
    fallbackError: "Failed to record Local AI failure",
  });
  return durableRunStatus(result);
}

async function cancelDurableRun(
  handle: TailoringRunHandle,
): Promise<DurableRunStatus> {
  const result = await fetchJson(`/api/tailoring-runs/${handle.id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ attemptId: handle.attemptId }),
    fallbackError: "Failed to cancel Local AI run",
  });
  return durableRunStatus(result);
}

function durableRunStatus(value: unknown): DurableRunStatus {
  const status =
    value && typeof value === "object" && "run" in value
      ? (value as { run?: { status?: unknown } }).run?.status
      : null;
  if (
    status === "ISSUED" ||
    status === "RUNNING" ||
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "PARTIAL"
  ) {
    return status;
  }
  throw new Error("TailoringRun response shape invalid");
}

export function useLocalAiRun(options: {
  enabled: boolean;
  onSucceeded: (run: LocalAiSucceededRun) => Promise<void>;
  maxRunMs?: number;
}) {
  const maxRunMs = options.maxRunMs ?? LOCAL_AI_MAX_RUN_MS;
  const restoredIdRef = useRef<string | null>(restoredRequestId());
  const [availability, setAvailability] = useState<LocalAiAvailability>("detecting");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(restoredIdRef.current);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [runState, setRunState] = useState<LocalAiRunState>(() =>
    restoredIdRef.current
      ? { status: "queued", requestId: restoredIdRef.current }
      : { status: "idle" },
  );
  const onSucceededRef = useRef(options.onSucceeded);
  const terminalConsumedRef = useRef(new Set<string>());
  const repairAttemptedRef = useRef(new Set<string>());
  const startInFlightRef = useRef(false);
  const lastStartRef = useRef<LastStart | null>(restoredLastStart());
  const runDeadlineRef = useRef<{ requestId: string; at: number } | null>(null);

  useEffect(() => {
    onSucceededRef.current = options.onSucceeded;
  }, [options.onSucceeded]);

  const checkAvailability = useCallback(async (signal?: AbortSignal) => {
    setAvailability("detecting");
    try {
      const result = await detectLocalAiAvailability({ signal });
      if (!signal?.aborted) setAvailability(result);
    } catch {
      if (!signal?.aborted) setAvailability("bridge_error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkAvailability(controller.signal);
    return () => controller.abort();
  }, [checkAvailability]);

  const clearActiveRequest = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LOCAL_AI_ACTIVE_REQUEST_KEY);
    }
    setActiveRequestId(null);
  }, []);

  const forgetLastStart = useCallback(() => {
    lastStartRef.current = null;
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LOCAL_AI_LAST_START_KEY);
    }
  }, []);

  const acceptRun = useCallback(async (run: LocalAiPublicRun) => {
    // This hook drives application runs only; fit-scan "match"/"triage" runs
    // are orchestrated by useFitScan and must never reach this state machine.
    if (run.target === "match" || run.target === "triage") return;
    if (run.status === "succeeded") {
      if (terminalConsumedRef.current.has(run.requestId)) return;
      terminalConsumedRef.current.add(run.requestId);
      setRunState({
        status: "importing",
        requestId: run.requestId,
        jobId: run.jobId,
        target: run.target,
        ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
      });
      try {
        await onSucceededRef.current(run);
        clearActiveRequest();
        forgetLastStart();
        setRunState({
          status: "succeeded",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
          ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
        });
      } catch (error) {
        // Strict-import rejections get exactly one AI repair on the same local
        // session (spec §12.2): the extension replays a short validator note to
        // Hermes instead of re-running the whole prompt, then polling resumes.
        if (
          error instanceof DraftImportError &&
          error.code === "INVALID_AI_RESULT" &&
          !repairAttemptedRef.current.has(run.requestId)
        ) {
          repairAttemptedRef.current.add(run.requestId);
          try {
            await sendLocalAiBridgeRequest(
              "REPAIR_RUN",
              { requestId: run.requestId, feedback: repairFeedbackFromError(error) },
              { timeoutMs: 10_000 },
            );
            terminalConsumedRef.current.delete(run.requestId);
            window.sessionStorage.setItem(LOCAL_AI_ACTIVE_REQUEST_KEY, run.requestId);
            runDeadlineRef.current = null;
            setActiveRequestId(run.requestId);
            setPollEpoch((value) => value + 1);
            setRunState({
              status: "running",
              requestId: run.requestId,
              jobId: run.jobId,
              target: run.target,
              ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
            });
            return;
          } catch {
            // Repair could not start; fall through to the import failure.
          }
        }
        // Keep the same durable request recoverable. A retry polls the
        // extension's persisted terminal result and replays the receipt-backed
        // Application acceptance instead of starting another model run.
        terminalConsumedRef.current.delete(run.requestId);
        window.sessionStorage.setItem(
          LOCAL_AI_ACTIVE_REQUEST_KEY,
          run.requestId,
        );
        setRunState({
          status: "failed",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
          ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
          error: {
            code: error instanceof DraftImportError && error.code === "INVALID_AI_RESULT"
              ? "INVALID_AI_RESULT"
              : "IMPORT_FAILED",
            retryable: true,
          },
        });
      }
      return;
    }
    if (run.status === "failed") {
      let durableStatus: DurableRunStatus = "FAILED";
      if (run.tailoringRun) {
        try {
          durableStatus = await failDurableRun(
            run.tailoringRun,
            run.error.code,
          );
        } catch {
          window.sessionStorage.setItem(
            LOCAL_AI_ACTIVE_REQUEST_KEY,
            run.requestId,
          );
          setRunState({
            status: "failed",
            requestId: run.requestId,
            jobId: run.jobId,
            target: run.target,
            tailoringRun: run.tailoringRun,
            error: { code: "RUN_FAILURE_SYNC_FAILED", retryable: true },
          });
          return;
        }
      }
      clearActiveRequest();
      forgetLastStart();
      if (durableStatus === "CANCELLED") {
        setRunState({
          status: "cancelled",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
          ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
        });
        return;
      }
      if (durableStatus === "SUCCEEDED") {
        setRunState({
          status: "succeeded",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
          ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
        });
        return;
      }
      setRunState({
        status: "failed",
        requestId: run.requestId,
        jobId: run.jobId,
        target: run.target,
        ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
        error: { code: run.error.code, retryable: run.error.retryable },
      });
      return;
    }
    if (run.status === "cancelled") {
      let durableStatus: DurableRunStatus = "CANCELLED";
      if (run.tailoringRun) {
        try {
          durableStatus = await cancelDurableRun(run.tailoringRun);
        } catch {
          window.sessionStorage.setItem(
            LOCAL_AI_ACTIVE_REQUEST_KEY,
            run.requestId,
          );
          setRunState({
            status: "failed",
            requestId: run.requestId,
            jobId: run.jobId,
            target: run.target,
            tailoringRun: run.tailoringRun,
            error: { code: "RUN_CANCEL_FAILED", retryable: true },
          });
          return;
        }
      }
      clearActiveRequest();
      forgetLastStart();
      if (durableStatus === "SUCCEEDED") {
        setRunState({
          status: "succeeded",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
          ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
        });
        return;
      }
      if (durableStatus === "FAILED" || durableStatus === "PARTIAL") {
        setRunState({
          status: "failed",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
          ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
          error: { code: "TAILORING_RUN_FAILED", retryable: false },
        });
        return;
      }
      setRunState({
        status: "cancelled",
        requestId: run.requestId,
        jobId: run.jobId,
        target: run.target,
        ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
      });
      return;
    }
    setRunState({
      status: run.status,
      requestId: run.requestId,
      jobId: run.jobId,
      target: run.target,
      ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
      ...(run.status === "running" && run.progressChars !== undefined
        ? { progressChars: run.progressChars }
        : {}),
    });
  }, [clearActiveRequest, forgetLastStart]);

  useEffect(() => {
    if (!options.enabled || !activeRequestId) return;
    let disposed = false;
    let timer: number | null = null;
    const controller = new AbortController();

    // Fix the run deadline once per requestId so it survives individual poll
    // iterations but resets for a fresh or retried run.
    if (runDeadlineRef.current?.requestId !== activeRequestId) {
      runDeadlineRef.current = { requestId: activeRequestId, at: Date.now() + maxRunMs };
    }

    const poll = async () => {
      try {
        const run = await sendLocalAiBridgeRequest(
          "GET_RUN",
          { requestId: activeRequestId },
          { signal: controller.signal, timeoutMs: 10_000 },
        );
        if (disposed) return;
        await acceptRun(run);
        if (!disposed && ["queued", "running", "stopping"].includes(run.status)) {
          if (Date.now() >= (runDeadlineRef.current?.at ?? Number.POSITIVE_INFINITY)) {
            // The run never reached a terminal state within budget. Keep the
            // active request so retry resumes polling the same run instead of
            // starting a duplicate (POST /v1/runs is not idempotent).
            setRunState({
              status: "failed",
              requestId: activeRequestId,
              jobId: run.jobId,
              target: run.target === "match" || run.target === "triage" ? undefined : run.target,
              ...(run.tailoringRun ? { tailoringRun: run.tailoringRun } : {}),
              error: { code: "AI_TIMEOUT", retryable: true },
            });
            return;
          }
          timer = window.setTimeout(() => void poll(), LOCAL_AI_POLL_MS);
        }
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const failure = bridgeFailure(error, "RUN_STATUS_FAILED");
        if (failure.code === "RUN_LOST") clearActiveRequest();
        setRunState((current) => ({
          status: "failed",
          requestId: activeRequestId,
          jobId: "jobId" in current ? current.jobId : undefined,
          target: "target" in current ? current.target : undefined,
          ...("tailoringRun" in current && current.tailoringRun
            ? { tailoringRun: current.tailoringRun }
            : {}),
          error: failure,
        }));
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [acceptRun, activeRequestId, clearActiveRequest, maxRunMs, options.enabled, pollEpoch]);

  const start = useCallback(async (jobId: string, target: "resume" | "cover") => {
    if (startInFlightRef.current || activeRequestId) return;
    if (availability !== "ready") {
      setRunState({
        status: "failed",
        jobId,
        target,
        error: { code: "LOCAL_AI_NOT_READY", retryable: true },
      });
      return;
    }
    startInFlightRef.current = true;
    const requestId = crypto.randomUUID();
    lastStartRef.current = { jobId, target };
    window.sessionStorage.setItem(
      LOCAL_AI_LAST_START_KEY,
      JSON.stringify(lastStartRef.current),
    );
    terminalConsumedRef.current.delete(requestId);
    window.sessionStorage.setItem(LOCAL_AI_ACTIVE_REQUEST_KEY, requestId);
    setRunState({ status: "starting", requestId, jobId, target });
    try {
      const run = await sendLocalAiBridgeRequest(
        "START_RUN",
        { requestId, jobId, target },
        { timeoutMs: 20_000 },
      );
      if (["queued", "running", "stopping"].includes(run.status)) {
        setActiveRequestId(requestId);
      }
      await acceptRun(run);
    } catch (error) {
      const failure = bridgeFailure(error, "RUN_START_FAILED");
      if (failure.code === "RUN_START_UNKNOWN" || failure.code === "BRIDGE_TIMEOUT") {
        setActiveRequestId(requestId);
        setRunState({ status: "queued", requestId, jobId, target });
        return;
      } else {
        window.sessionStorage.removeItem(LOCAL_AI_ACTIVE_REQUEST_KEY);
      }
      setRunState({
        status: "failed",
        requestId,
        jobId,
        target,
        error: failure,
      });
    } finally {
      startInFlightRef.current = false;
    }
  }, [acceptRun, activeRequestId, availability]);

  const stop = useCallback(async () => {
    if (!activeRequestId) return;
    const durableHandle =
      "tailoringRun" in runState ? runState.tailoringRun : undefined;
    if (durableHandle) {
      try {
        const status = await cancelDurableRun(durableHandle);
        if (status === "SUCCEEDED") {
          clearActiveRequest();
          forgetLastStart();
          setRunState((current) => {
            const jobId = "jobId" in current ? current.jobId : undefined;
            const target = "target" in current ? current.target : undefined;
            return jobId && target
              ? {
                  status: "succeeded",
                  requestId: activeRequestId,
                  jobId,
                  target,
                  tailoringRun: durableHandle,
                }
              : { status: "idle" };
          });
          return;
        }
      } catch {
        setRunState((current) => ({
          status: "failed",
          requestId: activeRequestId,
          jobId: "jobId" in current ? current.jobId : undefined,
          target: "target" in current ? current.target : undefined,
          tailoringRun: durableHandle,
          error: { code: "RUN_CANCEL_FAILED", retryable: true },
        }));
        return;
      }
    }
    setRunState((current) => ({
      status: "stopping",
      requestId: activeRequestId,
      jobId: "jobId" in current ? current.jobId : undefined,
      target: "target" in current ? current.target : undefined,
      ...(durableHandle ? { tailoringRun: durableHandle } : {}),
    }));
    try {
      await acceptRun(
        await sendLocalAiBridgeRequest("STOP_RUN", { requestId: activeRequestId }),
      );
    } catch (error) {
      setRunState((current) => ({
        status: "failed",
        requestId: activeRequestId,
        jobId: "jobId" in current ? current.jobId : undefined,
        target: "target" in current ? current.target : undefined,
        ...(durableHandle ? { tailoringRun: durableHandle } : {}),
        error: bridgeFailure(error, "RUN_STOP_FAILED"),
      }));
    }
  }, [
    acceptRun,
    activeRequestId,
    clearActiveRequest,
    forgetLastStart,
    runState,
  ]);

  const switchToManual = useCallback(async (): Promise<boolean> => {
    // START_RUN may still be between prompt issuance and registry persistence.
    // The dialog disables switching during that narrow state so reset cannot
    // race an in-flight start into an orphaned run.
    if (runState.status === "starting" || startInFlightRef.current) return false;
    if (!activeRequestId) {
      clearActiveRequest();
      forgetLastStart();
      setRunState({ status: "idle" });
      return true;
    }

    let observed: LocalAiPublicRun | null = null;
    let durableHandle =
      "tailoringRun" in runState ? runState.tailoringRun : undefined;
    if (!durableHandle) {
      try {
        observed = await sendLocalAiBridgeRequest(
          "GET_RUN",
          { requestId: activeRequestId },
          { timeoutMs: 10_000 },
        );
        durableHandle = observed.tailoringRun;
      } catch {
        // STOP_RUN remains the authority for legacy extension rows that have
        // no TailoringRun handle. If it also fails we keep the recovery key.
      }
    }

    if (durableHandle) {
      try {
        const status = await cancelDurableRun(durableHandle);
        if (status === "SUCCEEDED") {
          clearActiveRequest();
          forgetLastStart();
          setRunState((current) => {
            const jobId =
              observed?.jobId ??
              ("jobId" in current ? current.jobId : undefined);
            const target =
              observed?.target === "resume" || observed?.target === "cover"
                ? observed.target
                : "target" in current
                  ? current.target
                  : undefined;
            return jobId && target
              ? {
                  status: "succeeded",
                  requestId: activeRequestId,
                  jobId,
                  target,
                  tailoringRun: durableHandle,
                }
              : { status: "idle" };
          });
          return false;
        }
      } catch {
        setRunState((current) => ({
          status: "failed",
          requestId: activeRequestId,
          jobId: "jobId" in current ? current.jobId : undefined,
          target: "target" in current ? current.target : undefined,
          tailoringRun: durableHandle,
          error: { code: "RUN_CANCEL_FAILED", retryable: true },
        }));
        return false;
      }
    }

    let stopped: LocalAiPublicRun;
    try {
      stopped = await sendLocalAiBridgeRequest(
        "STOP_RUN",
        { requestId: activeRequestId },
        { timeoutMs: 10_000 },
      );
    } catch (error) {
      setRunState((current) => ({
        status: "failed",
        requestId: activeRequestId,
        jobId: "jobId" in current ? current.jobId : undefined,
        target: "target" in current ? current.target : undefined,
        ...(durableHandle ? { tailoringRun: durableHandle } : {}),
        error: bridgeFailure(error, "RUN_STOP_FAILED"),
      }));
      return false;
    }

    if (!durableHandle && stopped.tailoringRun) {
      try {
        await cancelDurableRun(stopped.tailoringRun);
      } catch {
        setRunState({
          status: "failed",
          requestId: activeRequestId,
          jobId: stopped.jobId,
          target:
            stopped.target === "resume" || stopped.target === "cover"
              ? stopped.target
              : undefined,
          tailoringRun: stopped.tailoringRun,
          error: { code: "RUN_CANCEL_FAILED", retryable: true },
        });
        return false;
      }
    }

    clearActiveRequest();
    forgetLastStart();
    setRunState({ status: "idle" });
    return true;
  }, [
    activeRequestId,
    clearActiveRequest,
    forgetLastStart,
    runState,
  ]);

  const retry = useCallback((fallbackJobId?: string, fallbackTarget?: "resume" | "cover") => {
    if (runState.status === "failed" && runState.error.code === "RUN_LOST") {
      const fallback = (
        fallbackJobId &&
        UUID_RE.test(fallbackJobId) &&
        (fallbackTarget === "resume" || fallbackTarget === "cover")
      )
        ? { jobId: fallbackJobId, target: fallbackTarget }
        : null;
      const next = lastStartRef.current ?? fallback;
      if (next) {
        void start(next.jobId, next.target);
      } else {
        setRunState({ status: "idle" });
      }
      return;
    }
    const durableRetryRequestId =
      runState.status === "failed" &&
      runState.requestId &&
      runState.tailoringRun &&
      window.sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY) ===
        runState.requestId
        ? runState.requestId
        : null;
    const requestId = activeRequestId ?? durableRetryRequestId;
    if (requestId) {
      runDeadlineRef.current = null;
      setRunState((current) => ({
        status: "queued",
        requestId,
        jobId: "jobId" in current ? current.jobId : undefined,
        target: "target" in current ? current.target : undefined,
        ...("tailoringRun" in current && current.tailoringRun
          ? { tailoringRun: current.tailoringRun }
          : {}),
      }));
      setActiveRequestId(requestId);
      setPollEpoch((value) => value + 1);
      return;
    }
    if (lastStartRef.current) {
      void start(lastStartRef.current.jobId, lastStartRef.current.target);
    }
  }, [activeRequestId, runState, start]);

  return {
    availability,
    runState,
    start,
    stop,
    retry,
    switchToManual,
    checkAvailability,
  };
}
