"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError } from "@/lib/api/fetchJson";
import {
  applicationReviewSchema,
  type AiApplicationReview,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import {
  extractMessage,
  type FinalizeResult,
  type TailorTarget,
} from "./tailorActions";
import {
  useTailoringOperationState,
  type SessionBusyState,
  type TailoringOperationState,
} from "./tailoringSessionOperation";
import { useTailorDraft, type SaveStatus } from "./useTailorDraft";
import {
  useTailoringPreviewLifecycle,
  type PreviewSyncStatus,
  type TailoringPreviewLifecycle,
} from "./useTailoringPreviewLifecycle";
import { useTailoringSessionCommands } from "./useTailoringSessionCommands";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

export type { PreviewSyncStatus } from "./useTailoringPreviewLifecycle";

export interface TailoringEditSessionMessages {
  conflict: string;
  saveFailed: string;
  previewFailed: string;
  finalizeFailed: string;
  discardFailed: string;
  exitFailed: string;
}

interface UseTailoringEditSessionOptions {
  applicationId: string;
  initialStatus: "DRAFT" | "FINAL";
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  initialResumePdfUrl: string | null;
  initialCoverPdfUrl: string | null;
  initialTarget?: TailorTarget;
  autoPreview?: boolean;
  messages: TailoringEditSessionMessages;
}

interface PreviewState {
  url: string | null;
  lastRefreshedAt: number | null;
  syncStatus: PreviewSyncStatus;
  refresh: () => Promise<boolean>;
}

interface SessionIssue {
  message: string | null;
  blockedReview: AiApplicationReview | null;
  clear: () => void;
}

export interface TailoringEditSession {
  document: {
    target: TailorTarget;
    select: (target: TailorTarget) => void;
    status: "DRAFT" | "FINAL";
  };
  content: {
    value: AiContent;
    update: (updater: (current: AiContent) => AiContent) => void;
    retrySave: () => Promise<boolean>;
    saveStatus: SaveStatus;
    currentHash: string | null;
  };
  preview: PreviewState;
  busy: SessionBusyState;
  issue: SessionIssue;
  finalize: () => Promise<FinalizeResult | null>;
  discard: () => Promise<boolean>;
  saveAndExit: (onSaved: () => void | Promise<void>) => Promise<boolean>;
}

interface DocumentState {
  target: TailorTarget;
  status: "DRAFT" | "FINAL";
  select: (target: TailorTarget) => void;
  setStatus: (status: "DRAFT" | "FINAL") => void;
  getActiveTarget: () => TailorTarget;
  replaceContent: (content: AiContent) => void;
  updateContent: (
    updater: (current: AiContent) => AiContent,
    onEdited: (target: TailorTarget) => void,
    setContent: (content: AiContent) => void,
  ) => void;
}

interface IssueState extends SessionIssue {
  report: (error: unknown, fallback: string) => void;
}

export function useTailoringEditSession(
  options: UseTailoringEditSessionOptions,
): TailoringEditSession {
  return useTailoringEditSessionModel(options);
}

function useTailoringEditSessionModel(
  options: UseTailoringEditSessionOptions,
): TailoringEditSession {
  const core = useTailoringSessionCore(options);
  const preview = useTailoringPreviewLifecycle({
    applicationId: options.applicationId,
    initialStatus: options.initialStatus,
    initialHash: options.initialAiContentHash,
    initialResumePdfUrl: options.initialResumePdfUrl,
    initialCoverPdfUrl: options.initialCoverPdfUrl,
    target: core.document.target,
    autoPreview: options.autoPreview ?? false,
    currentHash: core.draft.currentHash,
    saveKind: core.draft.saveStatus.kind,
    previewFailedMessage: options.messages.previewFailed,
    flushNow: core.draft.flushNow,
    isOperationActive: core.operations.isActive,
    clearIssue: core.issue.clear,
    reportIssue: core.issue.report,
  });
  const update = useContentEditor(core, preview);
  const retrySave = useSaveRetry(core, options.messages.saveFailed);
  const commands = useSessionCommands(options, core, preview);

  useUnsavedChangesGuard(
    core.draft.saveStatus.kind === "dirty" ||
      core.draft.saveStatus.kind === "saving",
  );
  return assembleSession(core, preview, commands, update, retrySave);
}

function useTailoringSessionCore(options: UseTailoringEditSessionOptions) {
  const draft = useTailorDraft({
    applicationId: options.applicationId,
    initialAiContent: options.initialAiContent,
    initialAiContentHash: options.initialAiContentHash,
    conflictMessage: options.messages.conflict,
    saveFailedMessage: options.messages.saveFailed,
  });
  const isMounted = useIsMounted();
  const operations = useTailoringOperationState();
  const issue = useSessionIssue(isMounted);
  const document = useDocumentState(
    options.initialTarget ?? "resume",
    options.initialStatus,
    draft.aiContent,
    operations,
  );
  return { draft, isMounted, operations, issue, document };
}

function useDocumentState(
  initialTarget: TailorTarget,
  initialStatus: "DRAFT" | "FINAL",
  aiContent: AiContent,
  operations: TailoringOperationState,
): DocumentState {
  const [target, setTarget] = useState<TailorTarget>(initialTarget);
  const [status, setStatus] = useState<"DRAFT" | "FINAL">(initialStatus);
  const activeTargetRef = useRef(initialTarget);
  const latestContentRef = useRef(aiContent);

  useEffect(() => {
    latestContentRef.current = aiContent;
  }, [aiContent]);

  const select = useCallback(
    (nextTarget: TailorTarget) => {
      if (operations.isActive()) return;
      activeTargetRef.current = nextTarget;
      setTarget(nextTarget);
    },
    [operations],
  );
  const getActiveTarget = useCallback(() => activeTargetRef.current, []);
  const replaceContent = useCallback((content: AiContent) => {
    latestContentRef.current = content;
  }, []);
  const updateContent = useCallback(
    (
      updater: (current: AiContent) => AiContent,
      onEdited: (target: TailorTarget) => void,
      setContent: (content: AiContent) => void,
    ) => {
      if (operations.isActive()) return;
      const activeTarget = activeTargetRef.current;
      onEdited(activeTarget);
      setStatus("DRAFT");
      const nextContent = updater(latestContentRef.current);
      latestContentRef.current = nextContent;
      setContent(nextContent);
    },
    [operations],
  );
  return {
    target, status, select, setStatus, getActiveTarget, replaceContent,
    updateContent,
  };
}

function useContentEditor(
  core: ReturnType<typeof useTailoringSessionCore>,
  preview: TailoringPreviewLifecycle,
) {
  const updateContent = core.document.updateContent;
  const markEdited = preview.markEdited;
  const setAiContent = core.draft.setAiContent;
  return useCallback(
    (updater: (current: AiContent) => AiContent) =>
      updateContent(updater, markEdited, setAiContent),
    [markEdited, setAiContent, updateContent],
  );
}

function useSaveRetry(
  core: ReturnType<typeof useTailoringSessionCore>,
  fallback: string,
) {
  return useCallback(async (): Promise<boolean> => {
    if (core.operations.isActive()) return false;
    core.issue.clear();
    try {
      await core.draft.flushNow();
      return true;
    } catch (error: unknown) {
      core.issue.report(error, fallback);
      return false;
    }
  }, [core, fallback]);
}

function useSessionCommands(
  options: UseTailoringEditSessionOptions,
  core: ReturnType<typeof useTailoringSessionCore>,
  preview: TailoringPreviewLifecycle,
) {
  return useTailoringSessionCommands({
    applicationId: options.applicationId,
    isMounted: core.isMounted,
    messages: options.messages,
    document: core.document,
    draft: core.draft,
    issue: core.issue,
    operations: core.operations,
    preview,
  });
}

function assembleSession(
  core: ReturnType<typeof useTailoringSessionCore>,
  preview: TailoringPreviewLifecycle,
  commands: ReturnType<typeof useTailoringSessionCommands>,
  update: TailoringEditSession["content"]["update"],
  retrySave: TailoringEditSession["content"]["retrySave"],
): TailoringEditSession {
  const target = core.document.target;
  return {
    document: {
      target,
      select: core.document.select,
      status: core.document.status,
    },
    content: {
      value: core.draft.aiContent,
      update,
      retrySave,
      saveStatus: core.draft.saveStatus,
      currentHash: core.draft.currentHash,
    },
    preview: {
      url: preview.view.pdfs[target],
      lastRefreshedAt: preview.view.refreshTimes[target],
      syncStatus: preview.view.syncStatuses[target],
      refresh: () => preview.refresh(core.document.getActiveTarget()),
    },
    busy: {
      refreshing: preview.view.refreshing,
      ...core.operations.busy,
    },
    issue: {
      message: core.issue.message,
      blockedReview: core.issue.blockedReview,
      clear: core.issue.clear,
    },
    ...commands,
  };
}

function useSessionIssue(isMounted: () => boolean): IssueState {
  const [message, setMessage] = useState<string | null>(null);
  const [blockedReview, setBlockedReview] =
    useState<AiApplicationReview | null>(null);
  const clear = useCallback(() => {
    setMessage(null);
    setBlockedReview(null);
  }, []);
  const report = useCallback(
    (error: unknown, fallback: string) => {
      if (!isMounted()) return;
      setMessage(extractMessage(error, fallback));
      setBlockedReview(extractBlockedReview(error));
    },
    [isMounted],
  );
  return { message, blockedReview, clear, report };
}

function useIsMounted(): () => boolean {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return useCallback(() => mountedRef.current, []);
}

function extractBlockedReview(error: unknown): AiApplicationReview | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 422 || error.code !== "APPLICATION_REVIEW_BLOCKED") {
    return null;
  }
  const parsed = applicationReviewSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}
