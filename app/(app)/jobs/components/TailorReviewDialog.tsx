"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchJson, ApiError } from "@/lib/api/fetchJson";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { cn } from "@/lib/utils";
import { BulletsSection } from "../[id]/tailor/BulletsSection";
import { ConflictDialog } from "../[id]/tailor/ConflictDialog";
import { CoverParagraphsSection } from "../[id]/tailor/CoverParagraphsSection";
import { PdfPreview } from "../[id]/tailor/PdfPreview";
import { SaveIndicator } from "../[id]/tailor/SaveIndicator";
import { SkillsSection } from "../[id]/tailor/SkillsSection";
import { SummarySection } from "../[id]/tailor/SummarySection";
import { useTailorDraft } from "../[id]/tailor/useTailorDraft";

type TailorTarget = "resume" | "cover";
type PreviewSyncStatus = "synced" | "pending" | "rendering";

const AUTO_PREVIEW_DEBOUNCE_MS = 1400;
const QUEUED_PREVIEW_DEBOUNCE_MS = 500;

export type TailorReviewDraft = {
  applicationId: string;
  target: TailorTarget;
  initialStatus: "DRAFT" | "FINAL";
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
  job: {
    id: string | null;
    title: string;
    company: string | null;
    location: string | null;
  };
};

export type TailorReviewFinalized = {
  target: TailorTarget;
  resumePdfUrl?: string;
  resumePdfName?: string;
  coverPdfUrl?: string;
  coverPdfName?: string;
};

type TailorReviewDialogProps = {
  open: boolean;
  draft: TailorReviewDraft | null;
  onOpenChange: (open: boolean) => void;
  onFinalized: (result: TailorReviewFinalized) => void;
};

export function TailorReviewDialog({
  open,
  draft,
  onOpenChange,
  onFinalized,
}: TailorReviewDialogProps) {
  return (
    <Dialog open={open && !!draft} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed left-2 top-2 flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none translate-x-0 translate-y-0 grid-rows-none flex-col gap-0 overflow-hidden rounded-[1.65rem] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_44%,#edf7f2_100%)] p-0 shadow-[0_34px_110px_-44px_rgba(15,23,42,0.70),0_16px_42px_-34px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/5 sm:left-4 sm:top-4 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-[2rem]"
      >
        {draft ? (
          <TailorReviewDialogBody
            key={`${draft.applicationId}-${draft.target}`}
            draft={draft}
            onClose={() => onOpenChange(false)}
            onFinalized={onFinalized}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TailorReviewDialogBody({
  draft: initialDraft,
  onClose,
  onFinalized,
}: {
  draft: TailorReviewDraft;
  onClose: () => void;
  onFinalized: (result: TailorReviewFinalized) => void;
}) {
  const draft = useTailorDraft({
    applicationId: initialDraft.applicationId,
    initialAiContent: initialDraft.initialAiContent,
    initialAiContentHash: initialDraft.initialAiContentHash,
  });
  const [status, setStatus] = useState<"DRAFT" | "FINAL">(
    initialDraft.initialStatus,
  );
  const [resumePdf, setResumePdf] = useState<string | null>(
    initialDraft.resumePdfUrl,
  );
  const [coverPdf, setCoverPdf] = useState<string | null>(
    initialDraft.coverPdfUrl,
  );
  const [lastResumeRefreshAt, setLastResumeRefreshAt] = useState<number | null>(
    initialDraft.resumePdfUrl ? Date.now() : null,
  );
  const [lastCoverRefreshAt, setLastCoverRefreshAt] = useState<number | null>(
    initialDraft.coverPdfUrl ? Date.now() : null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewSyncStatus, setPreviewSyncStatus] =
    useState<PreviewSyncStatus>("synced");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const initialPreviewUrl =
    initialDraft.target === "resume"
      ? initialDraft.resumePdfUrl
      : initialDraft.coverPdfUrl;
  const previewRenderedHashRef = useRef<string | null>(
    initialPreviewUrl ? initialDraft.initialAiContentHash : null,
  );
  const autoRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderInFlightRef = useRef(false);
  const renderQueuedRef = useRef(false);
  const latestHashRef = useRef<string | null>(draft.currentHash);
  const saveKindRef = useRef(draft.saveStatus.kind);
  const previewRenderRef = useRef<() => void>(() => {});

  const target = initialDraft.target;
  const targetLabel = target === "resume" ? "CV" : "Cover Letter";
  const currentPdf = target === "resume" ? resumePdf : coverPdf;
  const currentRefreshAt =
    target === "resume" ? lastResumeRefreshAt : lastCoverRefreshAt;
  const flushDraftNow = draft.flushNow;
  const canClose = !isFinalizing;
  const previewStatusLabel =
    previewSyncStatus === "rendering"
      ? "Rendering preview"
      : previewSyncStatus === "pending"
        ? "Queued after edit"
        : "Preview in sync";

  useEffect(() => {
    latestHashRef.current = draft.currentHash;
  }, [draft.currentHash]);

  useEffect(() => {
    saveKindRef.current = draft.saveStatus.kind;
  }, [draft.saveStatus.kind]);

  useEffect(
    () => () => {
      if (autoRenderTimerRef.current) {
        clearTimeout(autoRenderTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      draft.saveStatus.kind === "error" &&
      draft.saveStatus.message.includes("Another tab")
    ) {
      setShowConflictDialog(true);
    }
  }, [draft.saveStatus]);

  function patchSummary(summary: AiContent["cv"]["summary"]) {
    setStatus("DRAFT");
    draft.setAiContent({
      ...draft.aiContent,
      cv: { ...draft.aiContent.cv, summary },
    });
  }

  function patchLatestExperience(le: AiContent["cv"]["latestExperience"]) {
    setStatus("DRAFT");
    draft.setAiContent({
      ...draft.aiContent,
      cv: { ...draft.aiContent.cv, latestExperience: le },
    });
  }

  function patchSkills(sa: AiContent["cv"]["skillsAdditions"]) {
    setStatus("DRAFT");
    draft.setAiContent({
      ...draft.aiContent,
      cv: { ...draft.aiContent.cv, skillsAdditions: sa },
    });
  }

  function patchCover(cover: AiContent["cover"]) {
    setStatus("DRAFT");
    draft.setAiContent({ ...draft.aiContent, cover });
  }

  const callFinalize = useCallback(async () => {
    const expectedHash = await flushDraftNow();
    const json = await fetchJson<undefined>(
      `/api/applications/${initialDraft.applicationId}/finalize?target=${target}`,
      {
        method: "POST",
        body: JSON.stringify({ expectedHash }),
      },
    );
    return {
      expectedHash,
      data: json as {
        status: "FINAL";
        resumePdfUrl?: string;
        resumePdfName?: string;
        coverPdfUrl?: string;
        coverPdfName?: string;
      },
    };
  }, [flushDraftNow, initialDraft.applicationId, target]);

  const applyFinalizedResult = useCallback((data: {
    status: "FINAL";
    resumePdfUrl?: string;
    resumePdfName?: string;
    coverPdfUrl?: string;
    coverPdfName?: string;
  }) => {
    if (data.resumePdfUrl) {
      setResumePdf(data.resumePdfUrl);
      setLastResumeRefreshAt(Date.now());
    }
    if (data.coverPdfUrl) {
      setCoverPdf(data.coverPdfUrl);
      setLastCoverRefreshAt(Date.now());
    }
    setStatus("FINAL");
    onFinalized({
      target,
      resumePdfUrl: data.resumePdfUrl,
      resumePdfName: data.resumePdfName,
      coverPdfUrl: data.coverPdfUrl,
      coverPdfName: data.coverPdfName,
    });
  }, [onFinalized, target]);

  const schedulePreviewRender = useCallback(
    (delayMs = AUTO_PREVIEW_DEBOUNCE_MS) => {
      if (!latestHashRef.current) return;
      if (renderInFlightRef.current) {
        renderQueuedRef.current = true;
        setPreviewSyncStatus("pending");
        return;
      }
      if (autoRenderTimerRef.current) {
        clearTimeout(autoRenderTimerRef.current);
      }
      setPreviewSyncStatus("pending");
      autoRenderTimerRef.current = setTimeout(() => {
        autoRenderTimerRef.current = null;
        previewRenderRef.current();
      }, delayMs);
    },
    [],
  );

  const renderPreview = useCallback(async () => {
    if (renderInFlightRef.current) {
      renderQueuedRef.current = true;
      setPreviewSyncStatus("pending");
      return;
    }
    if (autoRenderTimerRef.current) {
      clearTimeout(autoRenderTimerRef.current);
      autoRenderTimerRef.current = null;
    }

    setActionError(null);
    renderInFlightRef.current = true;
    setPreviewSyncStatus("rendering");
    setIsRefreshing(true);
    try {
      const { data, expectedHash } = await callFinalize();
      previewRenderedHashRef.current = expectedHash;
      applyFinalizedResult(data);
    } catch (err: unknown) {
      setActionError(extractMessage(err, "Preview render failed"));
    } finally {
      renderInFlightRef.current = false;
      setIsRefreshing(false);
      const latestHash = latestHashRef.current;
      const needsFollowUp =
        renderQueuedRef.current ||
        (saveKindRef.current === "saved" &&
          !!latestHash &&
          previewRenderedHashRef.current !== latestHash);
      renderQueuedRef.current = false;

      if (needsFollowUp && latestHash && saveKindRef.current === "saved") {
        schedulePreviewRender(QUEUED_PREVIEW_DEBOUNCE_MS);
      } else {
        setPreviewSyncStatus("synced");
      }
    }
  }, [applyFinalizedResult, callFinalize, schedulePreviewRender]);

  useEffect(() => {
    previewRenderRef.current = () => {
      void renderPreview();
    };
  }, [renderPreview]);

  const handleRefresh = useCallback(async () => {
    await renderPreview();
  }, [renderPreview]);

  useEffect(() => {
    if (draft.saveStatus.kind !== "saved" || !draft.currentHash) return;
    if (previewRenderedHashRef.current === draft.currentHash) {
      if (!renderInFlightRef.current) setPreviewSyncStatus("synced");
      return;
    }
    schedulePreviewRender();

    return () => {
      if (autoRenderTimerRef.current) {
        clearTimeout(autoRenderTimerRef.current);
        autoRenderTimerRef.current = null;
      }
    };
  }, [draft.currentHash, draft.saveStatus.kind, schedulePreviewRender]);

  async function handleFinalize() {
    setActionError(null);
    setIsFinalizing(true);
    try {
      const { data, expectedHash } = await callFinalize();
      previewRenderedHashRef.current = expectedHash;
      applyFinalizedResult(data);
    } catch (err: unknown) {
      setActionError(extractMessage(err, "Finalize failed"));
    } finally {
      setIsFinalizing(false);
    }
  }

  async function handleDiscard() {
    setActionError(null);
    setIsDiscarding(true);
    try {
      const json = await fetchJson<undefined>(
        `/api/applications/${initialDraft.applicationId}/discard`,
        { method: "POST" },
      );
      const data = json as { aiContent: AiContent; aiContentHash: string };
      draft.replaceFromServer(data.aiContent, data.aiContentHash);
      setStatus("DRAFT");
    } catch (err: unknown) {
      setActionError(extractMessage(err, "Discard failed"));
    } finally {
      setIsDiscarding(false);
    }
  }

  return (
    <>
      <DialogHeader className="relative shrink-0 border-b border-slate-200/70 bg-white/90 px-5 py-4 text-left shadow-[0_12px_34px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl md:px-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-emerald-300/70 to-transparent"
        />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base md:text-lg">
              <span>Review tailored {targetLabel}</span>
              <StatusPill status={status} />
            </DialogTitle>
            <DialogDescription className="truncate text-xs md:text-sm">
              {initialDraft.job.title}
              {initialDraft.job.company ? ` | ${initialDraft.job.company}` : ""}
              {initialDraft.job.location ? ` | ${initialDraft.job.location}` : ""}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SaveIndicator status={draft.saveStatus} />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canClose}
              onClick={onClose}
              className="rounded-full text-muted-foreground transition-all hover:bg-slate-100 hover:text-foreground active:scale-95"
              aria-label="Close review dialog"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogHeader>

      {actionError ? (
        <div
          role="alert"
          className="mx-5 mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive shadow-sm md:mx-7"
        >
          {actionError}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-5 overflow-hidden bg-[radial-gradient(circle_at_6%_0%,rgba(16,185,129,0.09),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(59,130,246,0.055),transparent_30%)] p-4 md:p-6 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.65rem] border border-white/80 bg-white/75 p-3 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.55),0_8px_20px_-18px_rgba(15,23,42,0.20)] ring-1 ring-slate-900/5 backdrop-blur">
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 shadow-[0_10px_28px_-25px_rgba(15,23,42,0.42)]">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">AI proposals</p>
              <p className="truncate text-xs text-muted-foreground">
                Review edits, then the preview renders the accepted version.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
              {previewStatusLabel}
            </span>
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            <div className="flex flex-col gap-4 pb-2">
            {target === "resume" ? (
              <>
                <SummarySection
                  summary={draft.aiContent.cv.summary}
                  onChange={patchSummary}
                />
                <BulletsSection
                  latestExperience={draft.aiContent.cv.latestExperience}
                  onChange={patchLatestExperience}
                />
                <SkillsSection
                  skillsAdditions={draft.aiContent.cv.skillsAdditions}
                  onChange={patchSkills}
                />
              </>
            ) : (
              <CoverParagraphsSection
                cover={draft.aiContent.cover}
                onChange={patchCover}
              />
            )}
            </div>
          </div>
        </div>

        <div className="hidden min-h-0 lg:block">
          <PdfPreview
            pdfUrl={currentPdf}
            jobTitle={initialDraft.job.title}
            isRefreshing={isRefreshing}
            isPending={previewSyncStatus === "pending"}
            autoRefresh={false}
            lastRefreshedAt={currentRefreshAt}
            onRefresh={handleRefresh}
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200/70 bg-white/90 px-5 py-4 shadow-[0_-18px_48px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl md:flex-row md:items-center md:justify-between md:px-7">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <FileText className="h-4 w-4 text-brand-emerald-700" />
          <span className="hidden sm:inline">
            {previewSyncStatus === "pending"
              ? "Preview will update after you stop editing."
              : "Edit AI proposals here, then render the final PDF without leaving Jobs."}
          </span>
          <span className="sm:hidden">Edit here, then finalize.</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDiscard}
            disabled={isDiscarding}
            className="h-10 rounded-full border-slate-200 bg-white px-4 text-sm font-semibold text-foreground/85 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-md active:translate-y-0"
          >
            <RotateCcw className="h-4 w-4" />
            {isDiscarding ? "Discarding..." : "Discard"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={canClose ? onClose : undefined}
            disabled={!canClose}
            className="h-10 rounded-full border-slate-200 bg-white px-4 text-sm font-semibold text-foreground/85 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-md active:translate-y-0"
          >
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleFinalize}
            disabled={isFinalizing}
            className={cn(
              "h-10 rounded-full border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_-16px_rgba(16,185,129,0.85)] transition-all hover:-translate-y-px hover:border-brand-emerald-600 hover:bg-brand-emerald-600 hover:shadow-[0_18px_34px_-16px_rgba(16,185,129,0.95)] active:translate-y-0",
              "disabled:border-border disabled:bg-muted disabled:text-muted-foreground",
            )}
          >
            {isFinalizing ? "Finalizing..." : `Finalize ${targetLabel}`}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showConflictDialog ? (
        <ConflictDialog
          onReload={() => window.location.reload()}
          onOverwrite={() => window.location.reload()}
        />
      ) : null}
    </>
  );
}

function StatusPill({ status }: { status: "DRAFT" | "FINAL" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-wider",
        status === "FINAL"
          ? "bg-brand-emerald-100 text-brand-emerald-800"
          : "bg-amber-100 text-amber-800",
      )}
    >
      {status}
    </span>
  );
}

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
