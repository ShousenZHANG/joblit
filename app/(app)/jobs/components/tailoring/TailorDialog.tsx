"use client";

import { useCallback, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobItem } from "../../types";
import {
  DocumentTargetTabs,
  type DocumentTargetIndicator,
} from "./DocumentTargetTabs";
import { TailorDraftSteps } from "./TailorDraftSteps";
import { TailorLockedSteps } from "./TailorLockedSteps";
import { TailorPasteStep } from "./TailorPasteStep";
import { TailorPromptStep } from "./TailorPromptStep";
import type { TailorTarget } from "./tailorActions";
import type {
  TailorPhase,
  TailorReviewDraft,
  TailorReviewFinalized,
} from "./tailorDialogTypes";
import { useTailorGeneration } from "./useTailorGeneration";

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
 * The one tailoring surface: copy a prompt, paste the answer, edit it, publish.
 *
 * It replaced a two-dialog flow whose split was an implementation detail —
 * generation lived in one dialog and editing in another, so importing a result
 * closed one modal and opened a second one over the same job. One scrolling
 * column keeps every step of the same task in the same place.
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
  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,860px)] w-[min(96vw,760px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0">
        {job ? (
          <TailorDialogBody
            key={job.id}
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
  job: JobItem;
  initialTarget: TailorTarget;
  draft: TailorReviewDraft | null;
  draftLoading: boolean;
  draftError: string | null;
  onImported: (input: TailorImportedInput) => Promise<boolean>;
  onFinalized: (result: TailorReviewFinalized) => void;
}

function TailorDialogBody({
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
  const [target, setTarget] = useState<TailorTarget>(initialTarget);
  const [outputs, setOutputs] = useState<Record<TailorTarget, string>>({
    resume: "",
    cover: "",
  });
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

  const generation = useTailorGeneration({
    job,
    target,
    onCopied: (copiedTarget) => expandPhase(copiedTarget, "paste"),
  });

  const publication = draft?.initialPublication ?? null;
  const importedFor = (forTarget: TailorTarget) =>
    publication ? publication[forTarget].status !== "MISSING" : false;
  const publishedFor = (forTarget: TailorTarget) =>
    publishedTargets[forTarget] ||
    (publication ? publication[forTarget].status === "FINAL" : false);

  const hasContent = importedFor(target);
  const autoPhase: TailorPhase | "none" = publishedFor(target)
    ? "none"
    : hasContent
      ? "review"
      : "copy";
  const expandedPhase = phaseOverrides[target] ?? autoPhase;

  const copyState =
    expandedPhase === "copy"
      ? "expanded"
      : generation.hasCopied || hasContent
        ? "done"
        : "future";
  const pasteState =
    expandedPhase === "paste" ? "expanded" : hasContent ? "done" : "future";

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

  async function importCurrentOutput() {
    const applicationId = await generation.importOutput(outputs[target]);
    if (!applicationId) return;
    const loaded = await onImported({ applicationId, jobId: job.id, target });
    if (loaded) {
      setOutputs((current) => ({ ...current, [target]: "" }));
      setPhaseOverrides((current) => ({ ...current, [target]: null }));
    }
  }

  function handleFinalized(result: TailorReviewFinalized) {
    setPublishedTargets((current) => ({ ...current, [result.target]: true }));
    setPhaseOverrides((current) => ({ ...current, [result.target]: null }));
    onFinalized(result);
  }

  return (
    <>
      <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-6 py-4 text-left">
        <DialogTitle className="text-base font-semibold tracking-tight">
          {t("title")}
        </DialogTitle>
        <DialogDescription className="truncate text-xs">
          {[job.title, job.company].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
        <DocumentTargetTabs
          target={target}
          onSelect={setTarget}
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

            <TailorPromptStep
              index={1}
              state={copyState}
              onExpand={() => expandPhase(target, "copy")}
              generation={generation}
            />
            <TailorPasteStep
              index={2}
              state={pasteState}
              onExpand={() => expandPhase(target, "paste")}
              target={target}
              value={outputs[target]}
              onChange={(value) =>
                setOutputs((current) => ({ ...current, [target]: value }))
              }
              importing={generation.importing}
              importError={generation.importError}
              onImport={() => void importCurrentOutput()}
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

      <div className="shrink-0 border-t border-border/60 px-6 py-3">
        <p className="text-xs text-muted-foreground">
          {t("skillPackHint")}{" "}
          <button
            type="button"
            onClick={() => void generation.downloadSkillPack()}
            disabled={generation.skillPackLoading}
            className="font-medium text-brand-emerald-text underline-offset-4 transition-colors hover:underline disabled:cursor-progress disabled:opacity-60 motion-reduce:transition-none"
          >
            {generation.skillPackLoading
              ? t("skillPackDownloading")
              : t("skillPackLink")}
          </button>
        </p>
      </div>
    </>
  );
}
