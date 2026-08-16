"use client";

import { useState, type ReactElement } from "react";
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
import { DocumentTargetTabs } from "./DocumentTargetTabs";
import { TailorDraftSteps } from "./TailorDraftSteps";
import { TailorLockedSteps } from "./TailorLockedSteps";
import { TailorPasteStep } from "./TailorPasteStep";
import { TailorPromptStep } from "./TailorPromptStep";
import type { TailorTarget } from "./tailorActions";
import type {
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
  const generation = useTailorGeneration({ job, target });
  const hasContent = draft
    ? draft.initialPublication[target].status !== "MISSING"
    : false;

  async function importCurrentOutput() {
    const applicationId = await generation.importOutput(outputs[target]);
    if (!applicationId) return;
    const loaded = await onImported({ applicationId, jobId: job.id, target });
    if (loaded) setOutputs((current) => ({ ...current, [target]: "" }));
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
              state={hasContent ? "done" : "active"}
              generation={generation}
            />
            <TailorPasteStep
              index={2}
              state={
                hasContent ? "done" : outputs[target].trim() ? "active" : "todo"
              }
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
                onFinalized={onFinalized}
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
