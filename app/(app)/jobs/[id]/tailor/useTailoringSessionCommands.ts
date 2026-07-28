"use client";

import { useCallback } from "react";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import {
  discardDraft,
  finalizeApplication,
  type FinalizeResult,
  type TailorTarget,
} from "./tailorActions";
import type {
  SessionOperation,
  TailoringOperationState,
} from "./tailoringSessionOperation";
import type { TailoringPreviewLifecycle } from "./useTailoringPreviewLifecycle";
import type { TailorDraftCommit } from "./useTailorDraft";

interface CommandMessages {
  finalizeFailed: string;
  discardFailed: string;
  exitFailed: string;
}

interface CommandDocument {
  getActiveTarget: () => TailorTarget;
  replaceContent: (content: AiContent) => void;
  applyPublication: (publication: ApplicationPublication) => void;
}

interface CommandDraft {
  flushNow: () => Promise<TailorDraftCommit>;
  replaceFromServer: (content: AiContent, commit: TailorDraftCommit) => void;
  acceptServerCommit: (commit: TailorDraftCommit) => void;
}

interface CommandIssue {
  clear: () => void;
  report: (error: unknown, fallback: string) => void;
}

interface TailoringCommandContext {
  applicationId: string;
  isMounted: () => boolean;
  messages: CommandMessages;
  document: CommandDocument;
  draft: CommandDraft;
  issue: CommandIssue;
  operations: TailoringOperationState;
  preview: TailoringPreviewLifecycle;
}

export interface TailoringSessionCommands {
  finalize: () => Promise<FinalizeResult | null>;
  discard: () => Promise<boolean>;
  saveAndExit: (onSaved: () => void | Promise<void>) => Promise<boolean>;
}

export function useTailoringSessionCommands(
  context: TailoringCommandContext,
): TailoringSessionCommands {
  const finalize = useCallback(() => runFinalize(context), [context]);
  const discard = useCallback(() => runDiscard(context), [context]);
  const saveAndExit = useCallback(
    (onSaved: () => void | Promise<void>) =>
      runSaveAndExit(context, onSaved),
    [context],
  );
  return { finalize, discard, saveAndExit };
}

async function runFinalize(
  context: TailoringCommandContext,
): Promise<FinalizeResult | null> {
  if (!beginOwningOperation(context, "finalizing")) return null;
  try {
    const commit = await context.draft.flushNow();
    const result = await finalizeApplication({
      applicationId: context.applicationId,
      target: context.document.getActiveTarget(),
      expectedHash: commit.aiContentHash,
    });
    if (context.isMounted()) {
      context.draft.acceptServerCommit({
        aiContentHash: result.aiContentHash,
        publication: result.publication,
      });
      context.preview.applyFinalized(result);
      context.document.applyPublication(result.publication);
    }
    return result;
  } catch (error: unknown) {
    context.issue.report(error, context.messages.finalizeFailed);
    return null;
  } finally {
    context.operations.end("finalizing");
  }
}

async function runDiscard(
  context: TailoringCommandContext,
): Promise<boolean> {
  if (!beginOwningOperation(context, "discarding")) return false;
  try {
    const commit = await context.draft.flushNow();
    const result = await discardDraft({
      applicationId: context.applicationId,
      expectedHash: commit.aiContentHash,
    });
    if (context.isMounted()) applyDiscardResult(context, result);
    return true;
  } catch (error: unknown) {
    context.issue.report(error, context.messages.discardFailed);
    return false;
  } finally {
    context.operations.end("discarding");
  }
}

async function runSaveAndExit(
  context: TailoringCommandContext,
  onSaved: () => void | Promise<void>,
): Promise<boolean> {
  if (!beginOwningOperation(context, "exiting")) return false;
  try {
    await context.draft.flushNow();
    await onSaved();
    return true;
  } catch (error: unknown) {
    context.issue.report(error, context.messages.exitFailed);
    return false;
  } finally {
    context.operations.end("exiting");
  }
}

function beginOwningOperation(
  context: TailoringCommandContext,
  operation: SessionOperation,
) {
  if (!context.operations.begin(operation)) return false;
  context.preview.cancelForOperation();
  context.issue.clear();
  return true;
}

function applyDiscardResult(
  context: TailoringCommandContext,
  result: {
    aiContent: AiContent;
    aiContentHash: string | null;
    publication: ApplicationPublication;
  },
) {
  context.document.replaceContent(result.aiContent);
  context.draft.replaceFromServer(result.aiContent, {
    aiContentHash: result.aiContentHash,
    publication: result.publication,
  });
  context.preview.applyPublication(result.publication);
  context.document.applyPublication(result.publication);
}
