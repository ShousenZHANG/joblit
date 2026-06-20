"use client";

import { Check, ChevronDown, Copy, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { JobItem, ResumeImportOutput, CoverImportOutput } from "../types";
import type { DialogPhase } from "./StepIndicator";
import { StepIndicator } from "./StepIndicator";
import { StepImport } from "./StepImport";
import { JsonInputPanel } from "./JsonInputPanel";
import { GenerateProgress } from "./GenerateProgress";

const externalBtnPrimary =
  "h-10 rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-emerald-600 hover:border-brand-emerald-600 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none";

interface ExternalGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialogPhase: DialogPhase;
  setDialogPhase: (phase: DialogPhase) => void;
  externalTarget: "resume" | "cover";
  externalStep: 1 | 2 | 3;
  setExternalStep: (step: 1 | 2 | 3) => void;
  externalSkillPackFresh: boolean;
  setExternalSkillPackFresh: (fresh: boolean) => void;
  externalSkillPackLoading: boolean;
  externalPromptLoading: boolean;
  externalPromptMeta: unknown;
  externalPromptText: string;
  externalShortPromptText: string;
  promptCopied: boolean;
  externalModelOutput: string;
  setExternalModelOutput: (value: string) => void;
  externalGenerating: boolean;
  parsedExternalOutput: ResumeImportOutput | CoverImportOutput | null;
  selectedJob: JobItem | null;
  onCopySmartPrompt: () => void;
  onDownloadSkillPack: () => void;
  onGenerate: (job: JobItem, target: "resume" | "cover", modelOutput: string) => void;
}

export function ExternalGenerateDialog({
  open,
  onOpenChange,
  dialogPhase,
  setDialogPhase,
  externalTarget,
  externalStep: _externalStep,
  setExternalStep,
  externalSkillPackFresh,
  setExternalSkillPackFresh,
  externalSkillPackLoading,
  externalPromptLoading,
  externalPromptMeta,
  externalPromptText,
  externalShortPromptText,
  promptCopied,
  externalModelOutput,
  setExternalModelOutput,
  externalGenerating,
  parsedExternalOutput,
  selectedJob,
  onCopySmartPrompt,
  onDownloadSkillPack,
  onGenerate,
}: ExternalGenerateDialogProps) {
  const t = useTranslations("jobs.external");
  const tc = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && dialogPhase === "generating") return;
      onOpenChange(isOpen);
    }}>
      <DialogContent className="flex h-[min(90vh,720px)] w-[min(96vw,880px)] max-w-[880px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-base">
            {externalTarget === "resume"
              ? t("dialogTitleResume")
              : t("dialogTitleCover")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {dialogPhase === "generating"
              ? t("dialogDescGenerating")
              : t("dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {dialogPhase !== "generating" && (
          <div className="shrink-0 border-b border-border/60 px-5 py-3">
            <StepIndicator
              currentStep={dialogPhase}
              onStepClick={(s) => { setExternalStep(s); setDialogPhase(s); }}
              canGoToStep2={externalSkillPackFresh}
              canGoToStep3={externalPromptText.trim().length > 0}
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {dialogPhase === 1 && (
            <StepImport
              isFresh={externalSkillPackFresh}
              isLoading={externalSkillPackLoading}
              isPromptLoading={externalPromptLoading}
              hasPromptMeta={!!externalPromptMeta}
              onDownload={onDownloadSkillPack}
              onSkip={() => { setExternalSkillPackFresh(true); setExternalStep(2); setDialogPhase(2); }}
              onContinue={() => { setExternalStep(2); setDialogPhase(2); }}
            />
          )}

          {dialogPhase === 2 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-foreground/85 truncate">
                    {t.rich("docForJobAtCompany", {
                      doc: externalTarget === "resume" ? t("docResume") : t("docCover"),
                      job: selectedJob?.title ?? "...",
                      company: selectedJob?.company ?? "...",
                      strong: (chunks) => (
                        <span className="font-medium text-foreground">{chunks}</span>
                      ),
                    })}
                  </span>
                </div>
              </div>

              <Button
                type="button"
                size="lg"
                disabled={externalPromptLoading || !externalPromptText.trim()}
                onClick={onCopySmartPrompt}
                className={cn(
                  "h-12 w-full rounded-xl text-sm font-semibold shadow-sm transition-all duration-200 active:translate-y-[1px]",
                  promptCopied
                    ? "border-brand-emerald-500 bg-brand-emerald-500 text-white"
                    : "border-brand-emerald-500 bg-brand-emerald-500 text-white hover:bg-brand-emerald-600"
                )}
              >
                {externalPromptLoading ? (
                  t("buildingPrompt")
                ) : promptCopied ? (
                  <><Check className="mr-2 h-4 w-4 animate-in zoom-in-50 duration-200" /> {t("copied")}</>
                ) : (
                  <><Copy className="mr-2 h-4 w-4" /> {t("copyPrompt")}</>
                )}
              </Button>

              {promptCopied && (
                <p className="text-center text-sm text-brand-emerald-700">
                  {t("pasteHint")}
                </p>
              )}

              {externalPromptLoading ? (
                <div className="space-y-2" aria-hidden>
                  <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-24 w-full animate-pulse rounded-lg bg-muted/60" />
                </div>
              ) : (
                <details className="group">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/85">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    {t("previewPrompt", {
                      count: (externalSkillPackFresh ? externalShortPromptText : externalPromptText).length,
                    })}
                  </summary>
                  <pre className="mt-2 max-h-[200px] overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {externalSkillPackFresh ? externalShortPromptText : externalPromptText}
                  </pre>
                </details>
              )}
            </div>
          )}

          {dialogPhase === 3 && (
            <JsonInputPanel
              value={externalModelOutput}
              onChange={setExternalModelOutput}
              target={externalTarget}
              parsedOutput={parsedExternalOutput}
            />
          )}

          {dialogPhase === "generating" && (
            <GenerateProgress target={externalTarget} />
          )}
        </div>

        {typeof dialogPhase === "number" && (
          <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-5 py-3">
            <div>
              {dialogPhase > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const prev = (dialogPhase === 3 ? 2 : 1) as 1 | 2 | 3;
                    setExternalStep(prev);
                    setDialogPhase(prev);
                  }}
                  className="h-9 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground/85"
                >
                  {t("back")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="h-9 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground/85"
              >
                {tc("cancel")}
              </Button>
              {dialogPhase === 2 && (
                <Button
                  size="sm"
                  onClick={() => { setExternalStep(3); setDialogPhase(3); }}
                  className={externalBtnPrimary}
                >
                  {t("continue")}
                </Button>
              )}
              {dialogPhase === 3 && (
                <Button
                  size="sm"
                  className={externalBtnPrimary}
                  disabled={
                    !selectedJob ||
                    externalGenerating ||
                    !parsedExternalOutput ||
                    externalModelOutput.trim().length < 20
                  }
                  data-guide-anchor={externalTarget === "resume" ? "generate_first_pdf" : undefined}
                  onClick={() =>
                    selectedJob &&
                    onGenerate(selectedJob, externalTarget, externalModelOutput)
                  }
                >
                  {externalTarget === "resume" ? t("generateCvPdf") : t("generateCoverPdf")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
