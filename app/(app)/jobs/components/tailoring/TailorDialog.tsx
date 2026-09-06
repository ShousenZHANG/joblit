"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import type { JobItem } from "../../types";
import {
  DocumentTargetTabs,
  type DocumentTargetIndicator,
} from "./DocumentTargetTabs";
import { TailorDraftSteps } from "./TailorDraftSteps";
import { TailorGeneratePanel } from "./TailorGeneratePanel";
import { TailorLockedSteps } from "./TailorLockedSteps";
import { useLocalTailorCompanion } from "./useLocalTailorCompanion";
import { CompanionConnectionBar } from "./CompanionConnectionBar";
import type { TailorTarget } from "./tailorActions";
import type {
  TailorPhase,
  TailorReviewDraft,
  TailorReviewFinalized,
} from "./tailorDialogTypes";
import type { TailoringEditSession } from "./useTailoringEditSession";

export interface TailorImportedInput {
  applicationId: string;
  jobId: string;
  target: TailorTarget;
  source?: "manual_import" | "ai";
}

interface TailorDialogProps {
  job: JobItem | null;
  initialTarget: TailorTarget;
  draft: TailorReviewDraft | null;
  draftLoading: boolean;
  draftError: string | null;
  onOpenChange: (open: boolean) => void;
  onImported: (input: TailorImportedInput) => Promise<boolean>;
  onFinalized: (result: TailorReviewFinalized) => void;
}

/** A durable local task produces the PDF; this surface reconnects and edits it. */
export function TailorDialog({
  job,
  initialTarget,
  draft,
  draftLoading,
  draftError,
  onOpenChange,
  onImported,
  onFinalized,
}: TailorDialogProps): ReactElement {
  const closeRef = useRef<(() => void) | null>(null);
  return (
    <Dialog open={!!job} onOpenChange={(open) => {
      if (open) onOpenChange(true);
      else if (closeRef.current) closeRef.current();
      else onOpenChange(false);
    }}>
      <DialogContent onPointerDownOutside={(event) => event.preventDefault()} className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-[880px] flex-col gap-0 overflow-hidden rounded-3xl border-border/70 p-0 shadow-2xl sm:max-w-[880px]">
        {job ? (
          <TailorDialogBody
            key={job.id}
            closeRef={closeRef}
            onClose={() => onOpenChange(false)}
            job={job}
            initialTarget={initialTarget}
            draft={draft}
            draftLoading={draftLoading}
            draftError={draftError}
            onImported={onImported}
            onFinalized={onFinalized}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface TailorDialogBodyProps {
  closeRef: RefObject<(() => void) | null>;
  onClose: () => void;
  job: JobItem;
  initialTarget: TailorTarget;
  draft: TailorReviewDraft | null;
  draftLoading: boolean;
  draftError: string | null;
  onImported: (input: TailorImportedInput) => Promise<boolean>;
  onFinalized: (result: TailorReviewFinalized) => void;
}

function TailorDialogBody({
  closeRef,
  onClose,
  job,
  initialTarget,
  draft,
  draftLoading,
  draftError,
  onImported,
  onFinalized,
}: TailorDialogBodyProps): ReactElement {
  const t = useTranslations("tailor.dialog");
  const td = useTranslations("tailor");
  const [livePublication, setLivePublication] = useState<ApplicationPublication | null>(null);
  const editSessionRef = useRef<TailoringEditSession | null>(null);
  const [editState, setEditState] = useState({ busy: false, unsaved: false });
  const [target, setTarget] = useState<TailorTarget>(initialTarget);
  // null means "derive the expanded phase from the document's state"; a value
  // is the phase the user explicitly re-opened. Every successful action clears
  // the override so the accordion advances on its own.
  const [phaseOverrides, setPhaseOverrides] = useState<
    Record<TailorTarget, TailorPhase | null>
  >({ resume: null, cover: null });

  const expandPhase = useCallback((forTarget: TailorTarget, phase: TailorPhase) => {
    setPhaseOverrides((current) => ({ ...current, [forTarget]: phase }));
  }, []);

  const companion = useLocalTailorCompanion({ jobId: job.id, target });
  const { toast } = useToast();
  const completedTasks = useRef(new Set<string>());
  const observedRunningTasks = useRef(new Set<string>());
  const mounted = useRef(true);
  const accountKeyRef = useRef(companion.accountKey);
  useLayoutEffect(() => { accountKeyRef.current = companion.accountKey; }, [companion.accountKey]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleFinalized = useCallback((result: TailorReviewFinalized) => {
    setPhaseOverrides((current) => ({ ...current, [result.target]: null }));
    onFinalized(result);
  }, [onFinalized]);

  useEffect(() => {
    const task = companion.task;
    if (task && ["generating", "repairing", "publishing"].includes(task.status)) observedRunningTasks.current.add(task.taskId);
    if (task?.status !== "completed" || !task.result || completedTasks.current.has(task.taskId)) return;
    if (draftLoading || editState.busy || editState.unsaved) return;
    completedTasks.current.add(task.taskId);
    const result = task.result;
    const justFinished = companion.submittedTaskId === task.taskId || observedRunningTasks.current.has(task.taskId);
    // Reopening already loads the current snapshot. A historical receipt must
    // never overwrite newer edits, publication state, or a newer PDF URL.
    if (draft && !justFinished) return;
    const accountKey = companion.accountKey;
    void onImported({ applicationId: result.applicationId, jobId: task.jobId, target: task.target, source: "ai" }).then((loaded) => {
      if (!mounted.current || accountKeyRef.current !== accountKey) return;
      if (!loaded) { completedTasks.current.delete(task.taskId); return; }
      setLivePublication(null);
      setPhaseOverrides((current) => ({ ...current, [task.target]: null }));
      if (justFinished) toast({ title: t("generatePublishedToast"), duration: 2600 });
    }).catch(() => { completedTasks.current.delete(task.taskId); });
  }, [companion.accountKey, companion.submittedTaskId, companion.task, draft, draftLoading, editState.busy, editState.unsaved, onImported, t, toast]);

  const generating = companion.generating;
  useEffect(() => {
    closeRef.current = () => {
      const session = editSessionRef.current;
      if (session) void session.saveAndExit(onClose);
      else onClose();
    };
    return () => { closeRef.current = null; };
  }, [closeRef, onClose]);

  const publication = livePublication ?? draft?.initialPublication ?? null;
  const importedFor = (forTarget: TailorTarget) =>
    publication ? publication[forTarget].status !== "MISSING" : false;
  const publishedFor = (forTarget: TailorTarget) => publication?.[forTarget].status === "FINAL";

  const hasContent = importedFor(target);
  const autoPhase: TailorPhase | "none" = publishedFor(target)
    ? "none"
    : hasContent
      ? "review"
      : "none";
  const expandedPhase = phaseOverrides[target] ?? autoPhase;

  const indicatorFor = (
    forTarget: TailorTarget,
  ): DocumentTargetIndicator | null => {
    if (publishedFor(forTarget)) {
      return { kind: "published", label: td("docStatusPublished") };
    }
    if (importedFor(forTarget)) {
      return { kind: "draft", label: td("docStatusDraft") };
    }
    return null;
  };

  return (
    <>
      <DialogHeader className="shrink-0 space-y-2 border-b border-border/60 bg-muted/20 px-5 py-5 pr-14 text-left sm:px-7 sm:pr-16">
        <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <Sparkles className="size-5 text-brand-emerald-600" aria-hidden />
          {t("title")}
        </DialogTitle>
        <DialogDescription className="line-clamp-2 text-sm leading-relaxed" title={[job.title, job.company].filter(Boolean).join(" · ")}>
          {[job.title, job.company].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5 sm:px-7 sm:pb-7">
        <CompanionConnectionBar companion={companion} />
        <DocumentTargetTabs
          target={target}
          onSelect={setTarget}
          disabled={companion.starting || draftLoading || editState.busy || editState.unsaved}
          label={td("docTablistLabel")}
          labels={{ resume: td("docResume"), cover: td("docCover") }}
          indicators={{
            resume: indicatorFor("resume"),
            cover: indicatorFor("cover"),
          }}
        >
          <div className="pt-4">
            {draftError ? (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
              >
                {draftError}
              </p>
            ) : null}

            <TailorGeneratePanel
              hasContent={hasContent}
              disabled={draftLoading || editState.busy || editState.unsaved}
              target={target}
              companion={companion}
            />

            {draftLoading && !draft ? (
              <p className="flex items-center gap-2 border-t border-border/60 py-5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                {t("loadingDraft")}
              </p>
            ) : draft ? (
              // Re-key on the loaded content hash: importing the second
              // document rewrites the same aggregate server-side, and a session
              // still holding the pre-import snapshot would autosave it back
              // over the document that was just imported.
              <TailorDraftSteps
                sessionRef={editSessionRef}
                onPublicationChange={setLivePublication}
                onEditStateChange={setEditState}
                disabled={generating || companion.restoring || draftLoading}
                key={`${draft.applicationId}:${draft.initialAiContentHash ?? ""}`}
                draft={draft}
                target={target}
                expandedPhase={expandedPhase}
                onExpandPhase={(phase) => expandPhase(target, phase)}
                onFinalized={handleFinalized}
              />
            ) : (
              <TailorLockedSteps />
            )}
          </div>
        </DocumentTargetTabs>
      </div>
    </>
  );
}
