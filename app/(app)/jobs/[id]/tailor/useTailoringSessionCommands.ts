"use client";

import { useCallback } from "react";
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

interface CommandMessages {
  finalizeFailed: string;
  discardFailed: string;
  exitFailed: string;
}

interface CommandDocument {
  getActiveTarget: () => TailorTarget;
  replaceContent: (content: AiContent) => void;
  setStatus: (status: "DRAFT" | "FINAL") => void;
}

interface CommandDraft {
  flushNow: () => Promise<string | null>;
  replaceFromServer: (content: AiContent, hash: string | null) => void;
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
    const hash = await context.draft.flushNow();
    const result = await finalizeApplication({
      applicationId: context.applicationId,
      target: context.document.getActiveTarget(),
      expectedHash: hash,
    });
    if (context.isMounted()) {
      context.preview.applyFinalized(result, hash);
      context.document.setStatus("FINAL");
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
    const hash = await context.draft.flushNow();
    const result = await discardDraft({
      applicationId: context.applicationId,
      expectedHash: hash,
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
  result: { aiContent: AiContent; aiContentHash: string | null },
) {
  context.document.replaceContent(result.aiContent);
  context.draft.replaceFromServer(result.aiContent, result.aiContentHash);
  context.preview.invalidateAll();
  context.document.setStatus("DRAFT");
}
