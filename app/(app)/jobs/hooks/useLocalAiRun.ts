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

export const LOCAL_AI_ACTIVE_REQUEST_KEY = "joblit.local-ai.active-request.v1";
export const LOCAL_AI_LAST_START_KEY = "joblit.local-ai.last-start.v1";
export const LOCAL_AI_POLL_MS = 750;
// Total wall-clock budget for a single run. A run that never reaches a terminal
// state (e.g. the local model stalls or ChatGPT auth is not active) must not
// spin forever — spec §14.1 / §17 require a bounded total timeout.
export const LOCAL_AI_MAX_RUN_MS = 180_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LastStart = { jobId: string; target: "resume" | "cover" };

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
      progressChars?: number;
    }
  | { status: "importing"; requestId: string; jobId: string; target: "resume" | "cover" }
  | { status: "succeeded"; requestId: string; jobId: string; target: "resume" | "cover" }
  | { status: "cancelled"; requestId: string; jobId: string; target: "resume" | "cover" }
  | {
      status: "failed";
      requestId?: string;
      jobId?: string;
      target?: "resume" | "cover";
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
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim();
  return (text || "The JSON did not match the required schema.").slice(
    0,
    LOCAL_AI_MAX_REPAIR_FEEDBACK_CHARS,
  );
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
    if (run.status === "succeeded") {
      if (terminalConsumedRef.current.has(run.requestId)) return;
      terminalConsumedRef.current.add(run.requestId);
      clearActiveRequest();
      setRunState({
        status: "importing",
        requestId: run.requestId,
        jobId: run.jobId,
        target: run.target,
      });
      try {
        await onSucceededRef.current(run);
        forgetLastStart();
        setRunState({
          status: "succeeded",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
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
            });
            return;
          } catch {
            // Repair could not start; fall through to the import failure.
          }
        }
        setRunState({
          status: "failed",
          requestId: run.requestId,
          jobId: run.jobId,
          target: run.target,
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
      clearActiveRequest();
      setRunState({
        status: "failed",
        requestId: run.requestId,
        jobId: run.jobId,
        target: run.target,
        error: { code: run.error.code, retryable: run.error.retryable },
      });
      return;
    }
    if (run.status === "cancelled") {
      clearActiveRequest();
      forgetLastStart();
      setRunState({
        status: "cancelled",
        requestId: run.requestId,
        jobId: run.jobId,
        target: run.target,
      });
      return;
    }
    setRunState({
      status: run.status,
      requestId: run.requestId,
      jobId: run.jobId,
      target: run.target,
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
              target: run.target,
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
    setRunState((current) => ({
      status: "stopping",
      requestId: activeRequestId,
      jobId: "jobId" in current ? current.jobId : undefined,
      target: "target" in current ? current.target : undefined,
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
        error: bridgeFailure(error, "RUN_STOP_FAILED"),
      }));
    }
  }, [acceptRun, activeRequestId]);

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
    if (activeRequestId) {
      runDeadlineRef.current = null;
      setRunState((current) => ({
        status: "queued",
        requestId: activeRequestId,
        jobId: "jobId" in current ? current.jobId : undefined,
        target: "target" in current ? current.target : undefined,
      }));
      setPollEpoch((value) => value + 1);
      return;
    }
    if (lastStartRef.current) {
      void start(lastStartRef.current.jobId, lastStartRef.current.target);
    }
  }, [activeRequestId, runState, start]);

  const reset = useCallback(() => {
    clearActiveRequest();
    forgetLastStart();
    setRunState({ status: "idle" });
  }, [clearActiveRequest, forgetLastStart]);

  return {
    availability,
    runState,
    start,
    stop,
    retry,
    reset,
    checkAvailability,
  };
}
