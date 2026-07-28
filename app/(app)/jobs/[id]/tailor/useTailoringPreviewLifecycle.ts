"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type RefObject,
} from "react";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import {
  isAbortError,
  renderPreview,
  type FinalizeResult,
  type TailorTarget,
} from "./tailorActions";
import type { TailorDraftCommit } from "./useTailorDraft";

export type PreviewSyncStatus = "synced" | "pending" | "rendering" | "error";

interface PreviewViewState {
  pdfs: Record<TailorTarget, string | null>;
  refreshTimes: Record<TailorTarget, number | null>;
  syncStatuses: Record<TailorTarget, PreviewSyncStatus>;
  refreshing: boolean;
}

type PreviewViewAction =
  | {
      type: "status";
      target: TailorTarget;
      status: PreviewSyncStatus;
    }
  | { type: "refreshing"; value: boolean }
  | { type: "preview"; target: TailorTarget; url: string; at: number }
  | { type: "finalized"; result: FinalizeResult; at: number }
  | {
      type: "publication";
      publication: ApplicationPublication;
      pdfs: Record<TailorTarget, string | null>;
    }
  | { type: "cancel" };

interface PreviewRuntime {
  mounted: boolean;
  epoch: number;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
  inFlight: boolean;
  queuedTarget: TailorTarget | null;
  renderedHashes: Record<TailorTarget, string | null>;
  publishedUrls: Record<TailorTarget, string | null>;
  objectUrls: Record<TailorTarget, string | null>;
}

interface PreviewContext {
  applicationId: string;
  currentHash: string | null;
  publication: ApplicationPublication;
  saveKind: string;
  previewFailedMessage: string;
  flushNow: () => Promise<TailorDraftCommit>;
  isOperationActive: () => boolean;
  clearIssue: () => void;
  reportIssue: (error: unknown, fallback: string) => void;
  dispatch: React.Dispatch<PreviewViewAction>;
}

interface PreviewRequest {
  target: TailorTarget;
  epoch: number;
  controller: AbortController;
}

type PreviewOutcome =
  | { kind: "rendered"; url: string; hash: string | null }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

export interface UseTailoringPreviewLifecycleOptions {
  applicationId: string;
  initialPublication: ApplicationPublication;
  publication: ApplicationPublication;
  initialResumePdfUrl: string | null;
  initialCoverPdfUrl: string | null;
  target: TailorTarget;
  autoPreview: boolean;
  currentHash: string | null;
  saveKind: string;
  previewFailedMessage: string;
  flushNow: () => Promise<TailorDraftCommit>;
  isOperationActive: () => boolean;
  clearIssue: () => void;
  reportIssue: (error: unknown, fallback: string) => void;
}

export interface TailoringPreviewLifecycle {
  view: PreviewViewState;
  refresh: (target: TailorTarget) => Promise<boolean>;
  markEdited: (target: TailorTarget) => void;
  cancelForOperation: () => void;
  applyFinalized: (result: FinalizeResult) => void;
  applyPublication: (publication: ApplicationPublication) => void;
}

const AUTO_PREVIEW_DEBOUNCE_MS = 1_400;
const QUEUED_PREVIEW_DEBOUNCE_MS = 500;

export function useTailoringPreviewLifecycle(
  options: UseTailoringPreviewLifecycleOptions,
): TailoringPreviewLifecycle {
  const [view, dispatch] = useReducer(
    previewViewReducer,
    options,
    createInitialViewState,
  );
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  if (runtimeRef.current == null) {
    runtimeRef.current = createRuntime(options);
  }
  const contextRef = useRef<PreviewContext>(createContext(options, dispatch));
  const runnerRef = useRef<(target: TailorTarget) => Promise<boolean>>(
    async () => false,
  );
  const schedulerRef = useRef<
    (target: TailorTarget, delayMs?: number) => void
  >(() => undefined);

  useEffect(() => {
    contextRef.current = createContext(options, dispatch);
  }, [options]);

  const schedule = usePreviewScheduler(runtimeRef, contextRef, runnerRef);
  const refresh = usePreviewRunner(runtimeRef, contextRef, schedulerRef);
  useEffect(() => {
    runnerRef.current = refresh;
    schedulerRef.current = schedule;
  }, [refresh, schedule]);

  usePreviewMount(runtimeRef);
  useAutomaticPreview(options, runtimeRef, dispatch, schedule);
  const mutations = usePreviewMutations(runtimeRef, dispatch);
  return { view, refresh, ...mutations };
}

function usePreviewMutations(
  runtimeRef: RefObject<PreviewRuntime | null>,
  dispatch: React.Dispatch<PreviewViewAction>,
) {
  const markEdited = useCallback((target: TailorTarget) => {
    if (runtimeRef.current) {
      markPreviewEdited(runtimeRef.current, dispatch, target);
    }
  }, [dispatch, runtimeRef]);
  const cancelForOperation = useCallback(() => {
    if (runtimeRef.current) {
      cancelPreviewForOperation(runtimeRef.current, dispatch);
    }
  }, [dispatch, runtimeRef]);
  const applyFinalized = useCallback(
    (result: FinalizeResult) => {
      if (runtimeRef.current) {
        applyFinalizedPreview(runtimeRef.current, dispatch, result);
      }
    },
    [dispatch, runtimeRef],
  );
  const applyPublication = useCallback((publication: ApplicationPublication) => {
    if (runtimeRef.current) {
      reconcilePreviewPublication(runtimeRef.current, dispatch, publication);
    }
  }, [dispatch, runtimeRef]);
  return { markEdited, cancelForOperation, applyFinalized, applyPublication };
}

function usePreviewScheduler(
  runtimeRef: RefObject<PreviewRuntime | null>,
  contextRef: RefObject<PreviewContext>,
  runnerRef: RefObject<(target: TailorTarget) => Promise<boolean>>,
) {
  return useCallback(
    (target: TailorTarget, delayMs = AUTO_PREVIEW_DEBOUNCE_MS) => {
      const runtime = runtimeRef.current;
      const context = contextRef.current;
      if (!runtime) return;
      if (!context.currentHash) return;
      if (context.isOperationActive()) {
        setPreviewStatus(context.dispatch, target, "pending");
        return;
      }
      if (runtime.inFlight) {
        runtime.queuedTarget = target;
        setPreviewStatus(context.dispatch, target, "pending");
        return;
      }
      clearPreviewTimer(runtime);
      setPreviewStatus(context.dispatch, target, "pending");
      runtime.timer = setTimeout(() => {
        runtime.timer = null;
        void runnerRef.current(target);
      }, delayMs);
    },
    [contextRef, runnerRef, runtimeRef],
  );
}

function usePreviewRunner(
  runtimeRef: RefObject<PreviewRuntime | null>,
  contextRef: RefObject<PreviewContext>,
  schedulerRef: RefObject<
    (target: TailorTarget, delayMs?: number) => void
  >,
) {
  return useCallback(
    async (target: TailorTarget): Promise<boolean> => {
      const runtime = runtimeRef.current;
      const context = contextRef.current;
      if (!runtime) return false;
      if (context.isOperationActive()) return false;
      if (runtime.inFlight) {
        runtime.queuedTarget = target;
        setPreviewStatus(context.dispatch, target, "pending");
        return false;
      }
      clearPreviewTimer(runtime);
      context.clearIssue();
      const request = startPreview(runtime, context.dispatch, target);
      const outcome = await performPreview(runtime, context, request);
      settlePreview(
        runtime,
        contextRef.current,
        request,
        outcome,
        schedulerRef.current,
      );
      return outcome.kind === "rendered" && request.epoch === runtime.epoch;
    },
    [contextRef, runtimeRef, schedulerRef],
  );
}

function usePreviewMount(runtimeRef: RefObject<PreviewRuntime | null>) {
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.mounted = true;
    return () => disposePreviewRuntime(runtime);
  }, [runtimeRef]);
}

function useAutomaticPreview(
  options: UseTailoringPreviewLifecycleOptions,
  runtimeRef: RefObject<PreviewRuntime | null>,
  dispatch: React.Dispatch<PreviewViewAction>,
  schedule: (target: TailorTarget, delayMs?: number) => void,
) {
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!options.autoPreview) return;
    if (options.saveKind !== "saved" || !options.currentHash) return;
    const currentTargetHash = options.publication[options.target].contentHash;
    if (!currentTargetHash) return;
    if (runtime.renderedHashes[options.target] === currentTargetHash) {
      if (!runtime.inFlight) {
        setPreviewStatus(dispatch, options.target, "synced");
      }
      return;
    }
    schedule(options.target);
    return () => clearPreviewTimer(runtime);
  }, [
    dispatch,
    options.autoPreview,
    options.currentHash,
    options.publication,
    options.saveKind,
    options.target,
    runtimeRef,
    schedule,
  ]);
}

async function performPreview(
  runtime: PreviewRuntime,
  context: PreviewContext,
  request: PreviewRequest,
): Promise<PreviewOutcome> {
  try {
    const commit = await context.flushNow();
    if (!ownsPreview(runtime, context, request)) return { kind: "aborted" };
    const url = await renderPreview({
      applicationId: context.applicationId,
      target: request.target,
      expectedHash: commit.aiContentHash,
      signal: request.controller.signal,
      fallbackMessage: context.previewFailedMessage,
    });
    if (!ownsPreview(runtime, context, request)) {
      revokeDetachedObjectUrl(url);
      return { kind: "aborted" };
    }
    return {
      kind: "rendered",
      url,
      hash: commit.publication[request.target].contentHash,
    };
  } catch (error: unknown) {
    return isAbortError(error) ? { kind: "aborted" } : { kind: "error", error };
  }
}

function settlePreview(
  runtime: PreviewRuntime,
  context: PreviewContext,
  request: PreviewRequest,
  outcome: PreviewOutcome,
  schedule: (target: TailorTarget, delayMs?: number) => void,
) {
  finishRuntimeRequest(runtime, request);
  if (!runtime.mounted) return;
  if (request.epoch !== runtime.epoch) {
    scheduleQueuedPreview(runtime, context, schedule);
    return;
  }
  context.dispatch({ type: "refreshing", value: false });
  if (outcome.kind === "error") {
    context.reportIssue(outcome.error, context.previewFailedMessage);
    setPreviewStatus(context.dispatch, request.target, "error");
    scheduleQueuedPreview(runtime, context, schedule);
    return;
  }
  if (outcome.kind === "aborted") {
    setPreviewStatus(context.dispatch, request.target, "pending");
    scheduleQueuedPreview(runtime, context, schedule);
    return;
  }
  settleRenderedPreview(runtime, context, request.target, outcome, schedule);
}

function settleRenderedPreview(
  runtime: PreviewRuntime,
  context: PreviewContext,
  target: TailorTarget,
  outcome: Extract<PreviewOutcome, { kind: "rendered" }>,
  schedule: (target: TailorTarget, delayMs?: number) => void,
) {
  runtime.renderedHashes[target] = outcome.hash;
  replacePreviewObjectUrl(runtime, target, outcome.url);
  context.dispatch({ type: "preview", target, url: outcome.url, at: Date.now() });
  const needsFollowUp = settleRenderedSyncStatus(context, target, outcome);
  const queuedTarget = takeQueuedTarget(runtime);
  if (queuedTarget) {
    if (needsFollowUp && queuedTarget !== target) {
      runtime.queuedTarget = target;
    }
    schedule(queuedTarget, QUEUED_PREVIEW_DEBOUNCE_MS);
    return;
  }
  if (needsFollowUp) {
    schedule(target, QUEUED_PREVIEW_DEBOUNCE_MS);
  }
}

function settleRenderedSyncStatus(
  context: PreviewContext,
  target: TailorTarget,
  outcome: Extract<PreviewOutcome, { kind: "rendered" }>,
): boolean {
  if (
    context.publication[target].contentHash === outcome.hash &&
    context.saveKind === "saved"
  ) {
    setPreviewStatus(context.dispatch, target, "synced");
    return false;
  }
  setPreviewStatus(context.dispatch, target, "pending");
  return !!context.currentHash && context.saveKind === "saved";
}

function startPreview(
  runtime: PreviewRuntime,
  dispatch: React.Dispatch<PreviewViewAction>,
  target: TailorTarget,
): PreviewRequest {
  const controller = new AbortController();
  runtime.inFlight = true;
  runtime.controller = controller;
  dispatch({ type: "refreshing", value: true });
  setPreviewStatus(dispatch, target, "rendering");
  return { target, controller, epoch: runtime.epoch };
}

function finishRuntimeRequest(
  runtime: PreviewRuntime,
  request: PreviewRequest,
) {
  if (runtime.controller === request.controller) {
    runtime.controller = null;
  }
  runtime.inFlight = false;
}

function scheduleQueuedPreview(
  runtime: PreviewRuntime,
  context: PreviewContext,
  schedule: (target: TailorTarget, delayMs?: number) => void,
) {
  const target = takeQueuedTarget(runtime);
  if (target && !context.isOperationActive()) {
    schedule(target, QUEUED_PREVIEW_DEBOUNCE_MS);
  }
}

function takeQueuedTarget(runtime: PreviewRuntime): TailorTarget | null {
  const target = runtime.queuedTarget;
  runtime.queuedTarget = null;
  return target;
}

function ownsPreview(
  runtime: PreviewRuntime,
  context: PreviewContext,
  request: PreviewRequest,
) {
  return (
    runtime.mounted &&
    request.epoch === runtime.epoch &&
    !request.controller.signal.aborted &&
    !context.isOperationActive()
  );
}

function cancelPreviewForOperation(
  runtime: PreviewRuntime,
  dispatch: React.Dispatch<PreviewViewAction>,
) {
  runtime.epoch += 1;
  clearPreviewTimer(runtime);
  runtime.queuedTarget = null;
  runtime.controller?.abort();
  dispatch({ type: "cancel" });
}

function markPreviewEdited(
  runtime: PreviewRuntime,
  dispatch: React.Dispatch<PreviewViewAction>,
  target: TailorTarget,
) {
  runtime.renderedHashes[target] = null;
  setPreviewStatus(dispatch, target, "pending");
}

function applyFinalizedPreview(
  runtime: PreviewRuntime,
  dispatch: React.Dispatch<PreviewViewAction>,
  result: FinalizeResult,
) {
  if (result.resumePdfUrl) {
    runtime.renderedHashes.resume = result.publication.resume.publishedHash;
    runtime.publishedUrls.resume = result.resumePdfUrl;
    releasePreviewObjectUrl(runtime, "resume");
  }
  if (result.coverPdfUrl) {
    runtime.renderedHashes.cover = result.publication.cover.publishedHash;
    runtime.publishedUrls.cover = result.coverPdfUrl;
    releasePreviewObjectUrl(runtime, "cover");
  }
  dispatch({ type: "finalized", result, at: Date.now() });
}

function reconcilePreviewPublication(
  runtime: PreviewRuntime,
  dispatch: React.Dispatch<PreviewViewAction>,
  publication: ApplicationPublication,
) {
  runtime.renderedHashes = {
    resume: publication.resume.publishedHash,
    cover: publication.cover.publishedHash,
  };
  releasePreviewObjectUrl(runtime, "resume");
  releasePreviewObjectUrl(runtime, "cover");
  dispatch({
    type: "publication",
    publication,
    pdfs: runtime.publishedUrls,
  });
}

function disposePreviewRuntime(runtime: PreviewRuntime) {
  runtime.mounted = false;
  runtime.epoch += 1;
  clearPreviewTimer(runtime);
  runtime.queuedTarget = null;
  runtime.controller?.abort();
  releasePreviewObjectUrl(runtime, "resume");
  releasePreviewObjectUrl(runtime, "cover");
}

function replacePreviewObjectUrl(
  runtime: PreviewRuntime,
  target: TailorTarget,
  url: string,
) {
  releasePreviewObjectUrl(runtime, target);
  runtime.objectUrls[target] = url;
}

function releasePreviewObjectUrl(
  runtime: PreviewRuntime,
  target: TailorTarget,
) {
  const url = runtime.objectUrls[target];
  if (url && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
  runtime.objectUrls[target] = null;
}

function revokeDetachedObjectUrl(url: string) {
  if (typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

function clearPreviewTimer(runtime: PreviewRuntime) {
  if (!runtime.timer) return;
  clearTimeout(runtime.timer);
  runtime.timer = null;
}

function setPreviewStatus(
  dispatch: React.Dispatch<PreviewViewAction>,
  target: TailorTarget,
  status: PreviewSyncStatus,
) {
  dispatch({ type: "status", target, status });
}

function createContext(
  options: UseTailoringPreviewLifecycleOptions,
  dispatch: React.Dispatch<PreviewViewAction>,
): PreviewContext {
  return {
    applicationId: options.applicationId,
    currentHash: options.currentHash,
    publication: options.publication,
    saveKind: options.saveKind,
    previewFailedMessage: options.previewFailedMessage,
    flushNow: options.flushNow,
    isOperationActive: options.isOperationActive,
    clearIssue: options.clearIssue,
    reportIssue: options.reportIssue,
    dispatch,
  };
}

function createRuntime(
  options: UseTailoringPreviewLifecycleOptions,
): PreviewRuntime {
  return {
    mounted: true,
    epoch: 0,
    timer: null,
    controller: null,
    inFlight: false,
    queuedTarget: null,
    renderedHashes: {
      resume: initialRenderedHash(options, "resume"),
      cover: initialRenderedHash(options, "cover"),
    },
    publishedUrls: {
      resume: options.initialResumePdfUrl,
      cover: options.initialCoverPdfUrl,
    },
    objectUrls: { resume: null, cover: null },
  };
}

function createInitialViewState(
  options: UseTailoringPreviewLifecycleOptions,
): PreviewViewState {
  return {
    pdfs: {
      resume: options.initialResumePdfUrl,
      cover: options.initialCoverPdfUrl,
    },
    refreshTimes: { resume: null, cover: null },
    syncStatuses: {
      resume: initialSyncStatus(options, "resume"),
      cover: initialSyncStatus(options, "cover"),
    },
    refreshing: false,
  };
}

function initialSyncStatus(
  options: UseTailoringPreviewLifecycleOptions,
  target: TailorTarget,
): PreviewSyncStatus {
  const url =
    target === "resume"
      ? options.initialResumePdfUrl
      : options.initialCoverPdfUrl;
  const document = options.initialPublication[target];
  return document.status === "FINAL" &&
    !!url &&
    !!document.contentHash &&
    document.publishedHash === document.contentHash
    ? "synced"
    : "pending";
}

function initialRenderedHash(
  options: UseTailoringPreviewLifecycleOptions,
  target: TailorTarget,
): string | null {
  const url =
    target === "resume"
      ? options.initialResumePdfUrl
      : options.initialCoverPdfUrl;
  return url ? options.initialPublication[target].publishedHash : null;
}

function previewViewReducer(
  state: PreviewViewState,
  action: PreviewViewAction,
): PreviewViewState {
  switch (action.type) {
    case "status":
      if (state.syncStatuses[action.target] === action.status) return state;
      return {
        ...state,
        syncStatuses: {
          ...state.syncStatuses,
          [action.target]: action.status,
        },
      };
    case "refreshing":
      return state.refreshing === action.value
        ? state
        : { ...state, refreshing: action.value };
    case "preview":
      return applyPreviewViewState(state, action);
    case "finalized":
      return applyFinalizedViewState(state, action);
    case "cancel":
      return cancelPreviewViewState(state);
    case "publication":
      return applyPublicationViewState(
        state,
        action.publication,
        action.pdfs,
      );
  }
}

function applyPublicationViewState(
  state: PreviewViewState,
  publication: ApplicationPublication,
  pdfs: Record<TailorTarget, string | null>,
): PreviewViewState {
  return {
    ...state,
    pdfs: { ...pdfs },
    syncStatuses: {
      resume: publicationSyncStatus(pdfs.resume, publication.resume),
      cover: publicationSyncStatus(pdfs.cover, publication.cover),
    },
  };
}

function publicationSyncStatus(
  url: string | null,
  publication: ApplicationPublication["resume"],
): PreviewSyncStatus {
  return publication.status === "FINAL" &&
    !!url &&
    !!publication.contentHash &&
    publication.publishedHash === publication.contentHash
    ? "synced"
    : "pending";
}

function applyPreviewViewState(
  state: PreviewViewState,
  action: Extract<PreviewViewAction, { type: "preview" }>,
): PreviewViewState {
  return {
    ...state,
    pdfs: { ...state.pdfs, [action.target]: action.url },
    refreshTimes: { ...state.refreshTimes, [action.target]: action.at },
  };
}

function applyFinalizedViewState(
  state: PreviewViewState,
  action: Extract<PreviewViewAction, { type: "finalized" }>,
): PreviewViewState {
  const next = {
    ...state,
    pdfs: { ...state.pdfs },
    refreshTimes: { ...state.refreshTimes },
    syncStatuses: { ...state.syncStatuses },
  };
  applyFinalizedTarget(next, action, "resume", action.result.resumePdfUrl);
  applyFinalizedTarget(next, action, "cover", action.result.coverPdfUrl);
  return next;
}

function applyFinalizedTarget(
  state: PreviewViewState,
  action: Extract<PreviewViewAction, { type: "finalized" }>,
  target: TailorTarget,
  url: string | null | undefined,
) {
  if (!url) return;
  state.pdfs[target] = url;
  state.refreshTimes[target] = action.at;
  state.syncStatuses[target] = "synced";
}

function cancelPreviewViewState(state: PreviewViewState): PreviewViewState {
  return {
    ...state,
    refreshing: false,
    syncStatuses: {
      resume:
        state.syncStatuses.resume === "rendering"
          ? "pending"
          : state.syncStatuses.resume,
      cover:
        state.syncStatuses.cover === "rendering"
          ? "pending"
          : state.syncStatuses.cover,
    },
  };
}
