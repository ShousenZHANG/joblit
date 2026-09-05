"use client";

import { useCallback, useEffect, useRef, useState, type RefObject, type ReactElement } from "react";
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
import { marketStringToResumeLocale } from "@/lib/shared/market";
import type { JobItem } from "../../types";
import { getErrorMessage } from "../../types";
import {
  DocumentTargetTabs,
  type DocumentTargetIndicator,
} from "./DocumentTargetTabs";
import { TailorDraftSteps } from "./TailorDraftSteps";
import { TailorGeneratePanel } from "./TailorGeneratePanel";
import { TailorLockedSteps } from "./TailorLockedSteps";
import { useLocalTailorSidecar } from "./useLocalTailorSidecar";
import { finalizeApplication, type TailorTarget } from "./tailorActions";
import type {
  TailorPhase,
  TailorReviewDraft,
  TailorReviewFinalized,
} from "./tailorDialogTypes";
import type { TailoringEditSession } from "./useTailoringEditSession";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";
import { useTailorImport } from "./useTailorImport";

export interface TailorImportedInput {
  applicationId: string;
  jobId: string;
  target: TailorTarget;
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

/**
 * The one tailoring surface: generate, review, publish.
 *
 * Generation used to be a copy-prompt/paste-result pair of accordion steps —
 * the user carried a prompt to a chatbot by hand and carried JSON back. The
 * local sidecar (ADR-0024) does that round trip, so the dialog opens on a
 * single button and the steps that remain are the ones a person still acts on.
 */
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
  const [publishedTargets, setPublishedTargets] = useState<
    Record<TailorTarget, boolean>
  >({ resume: false, cover: false });

  const expandPhase = useCallback((forTarget: TailorTarget, phase: TailorPhase) => {
    setPhaseOverrides((current) => ({ ...current, [forTarget]: phase }));
  }, []);

  const importer = useTailorImport({ job, target });
  const sidecar = useLocalTailorSidecar();
  const { toast } = useToast();
  // The chain's own stage marker: the import hook's flag covers one call, and
  // the button's label has to name the publish half too.
  const [autoStage, setAutoStage] = useState<"importing" | "publishing" | null>(
    null,
  );
  // Held only when something downstream refused a generated result. Nothing
  // else keeps it now that the paste box is gone, and silently discarding work
  // the model already did is worse than offering it back.
  const [rescuable, setRescuable] = useState<string | null>(null);
  const [rescuableCopied, setRescuableCopied] = useState(false);

  const handleFinalized = useCallback((result: TailorReviewFinalized) => {
    setPublishedTargets((current) => ({ ...current, [result.target]: true }));
    setPhaseOverrides((current) => ({ ...current, [result.target]: null }));
    onFinalized(result);
  }, [onFinalized]);

  // The half of the chain that runs against the server: import the JSON, then
  // publish it. Split out because a refused import is often transient — a rate
  // limit, a blob hiccup — and re-running the model to retry would cost another
  // minute and another slice of the operator's quota for nothing.
  const importAndPublish = useCallback(
    async (generated: string) => {
      setAutoStage("importing");
      try {
        const imported = await importer.importOutput(generated);
        if (!imported) {
          setRescuable(generated);
          setRescuableCopied(false);
          return;
        }
        setRescuable(null);
        setPhaseOverrides((current) => ({ ...current, [target]: null }));
        setAutoStage("publishing");
        try {
          const result = await finalizeApplication({
            applicationId: imported.applicationId,
            target,
            expectedHash: imported.aiContentHash,
          });
          await onImported({
            applicationId: imported.applicationId,
            jobId: job.id,
            target,
          });
          handleFinalized({
            target,
            resumePdfUrl: result.resumePdfUrl,
            resumePdfName: result.resumePdfName,
            coverPdfUrl: result.coverPdfUrl,
            coverPdfName: result.coverPdfName,
          });
          toast({ title: t("generatePublishedToast"), duration: 2600 });
        } catch (error) {
          // The draft imported fine; only the render failed. It is stored and
          // editable, so load the review step and let the user publish from
          // there once the cause is fixed.
          await onImported({
            applicationId: imported.applicationId,
            jobId: job.id,
            target,
          });
          toast({
            title: t("generatePublishFailedToast"),
            description: getErrorMessage(error, t("errorFinalize")),
            variant: "destructive",
            duration: 4000,
          });
        }
      } finally {
        setAutoStage(null);
      }
    },
    [handleFinalized, importer, job.id, onImported, t, target, toast],
  );

  // One click, one outcome: generate, import and publish as a single chain, so
  // the button hands back a finished PDF. The server's gates stay the only
  // judge — the chain calls the same session-authenticated routes the dialog
  // always called — and every stage that fails says so without losing the
  // result it was handed.
  const generateLocally = useCallback(async () => {
    setRescuable(null);
    setRescuableCopied(false);
    // The locale has to be the one the import will resolve the profile with.
    // The server picks it from the job's market; the sidecar would otherwise
    // default to en-AU and select skills by index against the wrong bank, so a
    // CN job could publish skills the candidate never picked.
    const generated = await sidecar.generate({
      jobId: job.id,
      target,
      locale: marketStringToResumeLocale(job.market ?? "AU"),
    });
    if (!generated) return;
    await importAndPublish(generated);
  }, [importAndPublish, job.id, job.market, sidecar, target]);

  const retryRescuable = useCallback(() => {
    if (rescuable) void importAndPublish(rescuable);
  }, [importAndPublish, rescuable]);

  // The last net for a generated result, so a silent clipboard is not an
  // option: no clipboard API (an insecure origin, some embedded webviews) or a
  // denied permission falls back to a file the user can keep.
  const copyRescuable = useCallback(() => {
    if (!rescuable) return;
    const downloadInstead = () => {
      const url = URL.createObjectURL(
        new Blob([rescuable], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "joblit-generated.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setRescuableCopied(true);
    };
    if (!navigator.clipboard?.writeText) {
      downloadInstead();
      return;
    }
    void navigator.clipboard
      .writeText(rescuable)
      .then(() => setRescuableCopied(true), downloadInstead);
  }, [rescuable]);

  const generateStatus =
    autoStage === "importing"
      ? t("importing")
      : autoStage === "publishing"
        ? t("generatePublishing")
        : sidecar.progress?.phase === "generate"
          ? t("generateAttempt", {
              attempt: sidecar.progress.attempt,
              total: sidecar.progress.of,
            })
          : sidecar.progress?.phase === "rejected"
            ? t("generateRepairing", { code: sidecar.progress.code })
            : null;

  const generating = sidecar.running || autoStage !== null;
  useUnsavedChangesGuard(generating || !!rescuable);
  useEffect(() => {
    closeRef.current = () => {
      if (generating) {
        toast({ title: t("keepOpen"), duration: 3000 });
        return;
      }
      const session = editSessionRef.current;
      if (session) void session.saveAndExit(onClose);
      else onClose();
    };
    return () => { closeRef.current = null; };
  }, [closeRef, generating, onClose, t, toast]);

  const publication = livePublication ?? draft?.initialPublication ?? null;
  const importedFor = (forTarget: TailorTarget) =>
    publication ? publication[forTarget].status !== "MISSING" : false;
  const publishedFor = (forTarget: TailorTarget) =>
    livePublication
      ? livePublication[forTarget].status === "FINAL"
      : publishedTargets[forTarget] ||
        (publication ? publication[forTarget].status === "FINAL" : false);

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
        <DocumentTargetTabs
          target={target}
          onSelect={setTarget}
          disabled={generating || editState.busy || !!rescuable}
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
              stage={autoStage === "publishing" ? "publish" : autoStage === "importing" ? "import" : "generate"}
              target={target}
              onGenerate={() => void generateLocally()}
              generating={generating}
              status={generateStatus}
              error={sidecar.error ?? importer.importError}
              offline={sidecar.offline}
              rescuableOutput={rescuable}
              onRetryOutput={retryRescuable}
              onCopyOutput={copyRescuable}
              outputCopied={rescuableCopied}
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
                disabled={generating}
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
