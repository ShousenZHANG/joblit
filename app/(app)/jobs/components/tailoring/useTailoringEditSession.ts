"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ApplicationDocumentPublicationStatus,
  ApplicationPublication,
} from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
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
import {
  useTailorDraft,
  type SaveStatus,
  type TailorDraftCommit,
} from "./useTailorDraft";
import { useTailoringSessionCommands } from "./useTailoringSessionCommands";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

export interface TailoringEditSessionMessages {
  conflict: string;
  saveFailed: string;
  finalizeFailed: string;
  discardFailed: string;
  exitFailed: string;
}

interface UseTailoringEditSessionOptions {
  applicationId: string;
  initialPublication: ApplicationPublication;
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  initialTarget?: TailorTarget;
  messages: TailoringEditSessionMessages;
}

interface SessionIssue {
  message: string | null;
  clear: () => void;
}

export interface TailoringEditSession {
  document: {
    target: TailorTarget;
    select: (target: TailorTarget) => void;
    status: "DRAFT" | "FINAL";
    publication: ApplicationPublication;
  };
  content: {
    value: AiContent;
    update: (updater: (current: AiContent) => AiContent) => void;
    retrySave: () => Promise<boolean>;
    saveStatus: SaveStatus;
    currentHash: string | null;
  };
  busy: SessionBusyState;
  issue: SessionIssue;
  finalize: () => Promise<FinalizeResult | null>;
  discard: () => Promise<boolean>;
  saveAndExit: (onSaved: () => void | Promise<void>) => Promise<boolean>;
}

interface DocumentState {
  target: TailorTarget;
  status: "DRAFT" | "FINAL";
  publication: ApplicationPublication;
  select: (target: TailorTarget) => void;
  applyPublication: (publication: ApplicationPublication) => void;
  getActiveTarget: () => TailorTarget;
  replaceContent: (content: AiContent) => void;
  updateContent: (
    updater: (current: AiContent) => AiContent,
    setContent: (content: AiContent) => void,
  ) => void;
}

interface IssueState extends SessionIssue {
  report: (error: unknown, fallback: string) => void;
}

interface PublicationState {
  value: ApplicationPublication;
  apply: (publication: ApplicationPublication) => void;
  applyCommit: (commit: TailorDraftCommit) => void;
  markDraft: (target: TailorTarget) => void;
}

export function useTailoringEditSession(
  options: UseTailoringEditSessionOptions,
): TailoringEditSession {
  const core = useTailoringSessionCore(options);
  const update = useContentEditor(core);
  const retrySave = useSaveRetry(core, options.messages.saveFailed);
  const commands = useSessionCommands(options, core);

  useUnsavedChangesGuard(
    core.draft.saveStatus.kind === "dirty" ||
      core.draft.saveStatus.kind === "saving",
  );
  return assembleSession(core, commands, update, retrySave);
}

function useTailoringSessionCore(options: UseTailoringEditSessionOptions) {
  const publication = usePublicationState(options.initialPublication);
  const draft = useTailorDraft({
    applicationId: options.applicationId,
    initialAiContent: options.initialAiContent,
    initialAiContentHash: options.initialAiContentHash,
    initialPublication: options.initialPublication,
    onCommitted: publication.applyCommit,
    conflictMessage: options.messages.conflict,
    saveFailedMessage: options.messages.saveFailed,
  });
  const isMounted = useIsMounted();
  const operations = useTailoringOperationState();
  const issue = useSessionIssue(isMounted);
  const document = useDocumentState(
    options.initialTarget ?? "resume",
    publication,
    draft.aiContent,
    operations,
  );
  return { draft, isMounted, operations, issue, document };
}

function useDocumentState(
  initialTarget: TailorTarget,
  publication: PublicationState,
  aiContent: AiContent,
  operations: TailoringOperationState,
): DocumentState {
  const [target, setTarget] = useState<TailorTarget>(initialTarget);
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
      setContent: (content: AiContent) => void,
    ) => {
      if (operations.isActive()) return;
      publication.markDraft(activeTargetRef.current);
      const nextContent = updater(latestContentRef.current);
      latestContentRef.current = nextContent;
      setContent(nextContent);
    },
    [operations, publication],
  );
  return {
    target,
    status: editableStatus(publication.value[target].status),
    publication: publication.value,
    select,
    applyPublication: publication.apply,
    getActiveTarget,
    replaceContent,
    updateContent,
  };
}

function usePublicationState(
  initialPublication: ApplicationPublication,
): PublicationState {
  const [value, setValue] =
    useState<ApplicationPublication>(initialPublication);
  const apply = useCallback((publication: ApplicationPublication) => {
    setValue(publication);
  }, []);
  const applyCommit = useCallback(
    (commit: TailorDraftCommit) => {
      apply(commit.publication);
    },
    [apply],
  );
  const markDraft = useCallback((target: TailorTarget) => {
    setValue((current) => markTargetDraft(current, target));
  }, []);
  return { value, apply, applyCommit, markDraft };
}

function editableStatus(
  status: ApplicationDocumentPublicationStatus,
): "DRAFT" | "FINAL" {
  return status === "FINAL" ? "FINAL" : "DRAFT";
}

function markTargetDraft(
  publication: ApplicationPublication,
  target: TailorTarget,
): ApplicationPublication {
  if (publication[target].status === "DRAFT" && publication.status === "DRAFT") {
    return publication;
  }
  return {
    ...publication,
    status: "DRAFT",
    [target]: {
      ...publication[target],
      status: "DRAFT",
    },
  };
}

function useContentEditor(core: ReturnType<typeof useTailoringSessionCore>) {
  const updateContent = core.document.updateContent;
  const setAiContent = core.draft.setAiContent;
  return useCallback(
    (updater: (current: AiContent) => AiContent) =>
      updateContent(updater, setAiContent),
    [setAiContent, updateContent],
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
) {
  return useTailoringSessionCommands({
    applicationId: options.applicationId,
    isMounted: core.isMounted,
    messages: options.messages,
    document: core.document,
    draft: core.draft,
    issue: core.issue,
    operations: core.operations,
  });
}

function assembleSession(
  core: ReturnType<typeof useTailoringSessionCore>,
  commands: ReturnType<typeof useTailoringSessionCommands>,
  update: TailoringEditSession["content"]["update"],
  retrySave: TailoringEditSession["content"]["retrySave"],
): TailoringEditSession {
  return {
    document: {
      target: core.document.target,
      select: core.document.select,
      status: core.document.status,
      publication: core.document.publication,
    },
    content: {
      value: core.draft.aiContent,
      update,
      retrySave,
      saveStatus: core.draft.saveStatus,
      currentHash: core.draft.currentHash,
    },
    busy: core.operations.busy,
    issue: {
      message: core.issue.message,
      clear: core.issue.clear,
    },
    ...commands,
  };
}

function useSessionIssue(isMounted: () => boolean): IssueState {
  const [message, setMessage] = useState<string | null>(null);
  const clear = useCallback(() => setMessage(null), []);
  const report = useCallback(
    (error: unknown, fallback: string) => {
      if (!isMounted()) return;
      setMessage(extractMessage(error, fallback));
    },
    [isMounted],
  );
  return { message, clear, report };
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
