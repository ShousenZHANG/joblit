"use client";

import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, FileText, RotateCcw, X } from "lucide-react";
import {
  DocumentWorkbench,
  type DocumentWorkbenchPane,
} from "@/components/document/DocumentWorkbench";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildPdfFilename } from "@/lib/shared/pdfFilename";
import { cn } from "@/lib/utils";
import { ConflictDialog } from "../[id]/tailor/ConflictDialog";
import { PdfPreview } from "../[id]/tailor/PdfPreview";
import { ReviewGateCard } from "../[id]/tailor/ReviewGateCard";
import { SaveIndicator } from "../[id]/tailor/SaveIndicator";
import { TailoringProposalEditor } from "../[id]/tailor/TailoringProposalEditor";
import type { TailoringEditSession } from "../[id]/tailor/useTailoringEditSession";
import type { TailorReviewDraft } from "./TailorReviewDialog.types";

type TailorReviewDialogViewProps = {
  draft: TailorReviewDraft;
  session: TailoringEditSession;
  onClose: () => void;
  onFinalize: () => void;
};

type SessionViewProps = {
  session: TailoringEditSession;
};

export function TailorReviewDialogView({
  draft,
  session,
  onClose,
  onFinalize,
}: TailorReviewDialogViewProps): ReactElement {
  const [pane, setPane] = useState<DocumentWorkbenchPane>("editor");
  const interactionLocked = isInteractionLocked(session);
  const showConflict =
    session.content.saveStatus.kind === "error" &&
    session.content.saveStatus.conflict === true;

  return (
    <>
      <ReviewDialogHeader draft={draft} session={session} onClose={onClose} />
      <ReviewIssueRegion session={session} />
      <ReviewWorkbench
        draft={draft}
        session={session}
        pane={pane}
        onPaneChange={setPane}
        interactionLocked={interactionLocked}
      />
      <ReviewDialogFooter
        session={session}
        onClose={onClose}
        onFinalize={onFinalize}
      />
      {showConflict ? <ReloadConflictDialog /> : null}
    </>
  );
}

function isInteractionLocked(session: TailoringEditSession): boolean {
  return session.busy.exiting || session.busy.discarding || session.busy.finalizing;
}

function canCloseReview(session: TailoringEditSession): boolean {
  return !session.busy.finalizing && !session.busy.exiting && !session.busy.discarding;
}

function ReviewDialogHeader({
  draft,
  session,
  onClose,
}: {
  draft: TailorReviewDraft;
  session: TailoringEditSession;
  onClose: () => void;
}): ReactElement {
  return (
    <DialogHeader className="relative shrink-0 border-b border-border/70 bg-card/90 px-4 py-4 text-left shadow-[0_12px_34px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl sm:px-5 md:px-7">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-emerald-300/70 to-transparent"
      />
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <ReviewHeaderCopy draft={draft} session={session} />
        <ReviewHeaderActions session={session} onClose={onClose} />
      </div>
    </DialogHeader>
  );
}

function ReviewHeaderCopy({
  draft,
  session,
}: {
  draft: TailorReviewDraft;
  session: TailoringEditSession;
}): ReactElement {
  const t = useTranslations("tailor");
  const target =
    session.document.target === "resume"
      ? t("dialog.targetResume")
      : t("dialog.targetCover");
  const metadata = [draft.job.title, draft.job.company, draft.job.location]
    .filter((value): value is string => !!value)
    .join(" · ");
  return (
    <div className="min-w-0 space-y-1">
      <DialogTitle className="flex flex-wrap items-center gap-2 text-base md:text-lg">
        <span>{t("dialog.title", { target })}</span>
        <StatusPill
          status={session.document.status}
          label={
            session.document.status === "FINAL"
              ? t("statusFinal")
              : t("statusDraft")
          }
        />
      </DialogTitle>
      <DialogDescription className="truncate text-xs md:text-sm">
        {metadata}
      </DialogDescription>
    </div>
  );
}

function ReviewHeaderActions({
  session,
  onClose,
}: SessionViewProps & {
  onClose: () => void;
}): ReactElement {
  const t = useTranslations("tailor");
  return (
    <div className="flex shrink-0 items-center gap-2">
      <SaveIndicator
        status={session.content.saveStatus}
        onRetry={() => void session.content.retrySave()}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canCloseReview(session)}
        onClick={onClose}
        className="min-h-11 min-w-11 touch-manipulation rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        aria-label={t("dialog.closeReviewAria")}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

function ReviewIssueRegion({ session }: SessionViewProps): ReactElement | null {
  const t = useTranslations("tailor");
  if (session.issue.message && session.issue.blockedReview) {
    return (
      <div className="mx-4 mt-4 sm:mx-5 md:mx-7">
        <ReviewGateCard review={session.issue.blockedReview} />
      </div>
    );
  }
  if (!session.issue.message) return null;
  return (
    <div
      role="alert"
      className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive shadow-sm sm:mx-5 md:mx-7"
    >
      <span className="min-w-0 py-2">{session.issue.message}</span>
      <button
        type="button"
        onClick={session.issue.clear}
        aria-label={t("dismissError")}
        className="inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function ReviewWorkbench({
  draft,
  session,
  pane,
  onPaneChange,
  interactionLocked,
}: {
  draft: TailorReviewDraft;
  session: TailoringEditSession;
  pane: DocumentWorkbenchPane;
  onPaneChange: (pane: DocumentWorkbenchPane) => void;
  interactionLocked: boolean;
}): ReactElement {
  const t = useTranslations("tailor");
  return (
    <div
      aria-busy={interactionLocked}
      inert={interactionLocked ? true : undefined}
      className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_6%_0%,rgba(16,185,129,0.09),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(59,130,246,0.055),transparent_30%)] p-3 sm:p-4 md:p-6 lg:overflow-hidden"
    >
      <DocumentWorkbench
        pane={pane}
        onPaneChange={onPaneChange}
        labels={{
          tablist: t("workbench.tablist"),
          editor: t("workbench.editor"),
          preview: t("workbench.preview"),
        }}
        editor={<ReviewEditorPane session={session} />}
        preview={<ReviewPreviewPane draft={draft} session={session} />}
        columns="minmax(0, 1fr) minmax(0, 1fr)"
        className="lg:h-full"
      />
    </div>
  );
}

function ReviewEditorPane({ session }: SessionViewProps): ReactElement {
  const t = useTranslations("tailor");
  const status = getPreviewStatusLabel(session, t);
  return (
    <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-[1.65rem] border border-border/60 bg-card/75 p-3 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.55),0_8px_20px_-18px_rgba(15,23,42,0.20)] ring-1 ring-border/40 backdrop-blur lg:h-full lg:min-h-0">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-[0_10px_28px_-25px_rgba(15,23,42,0.42)]">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t("dialog.proposalsTitle")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {t("dialog.proposalsDescription")}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">
          {status}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="pb-2">
          <TailoringProposalEditor
            target={session.document.target}
            content={session.content.value}
            onUpdate={session.content.update}
          />
        </div>
      </div>
    </div>
  );
}

function getPreviewStatusLabel(
  session: TailoringEditSession,
  t: ReturnType<typeof useTranslations<"tailor">>,
): string {
  if (session.preview.syncStatus === "rendering") {
    return t("dialog.previewStatus.rendering");
  }
  if (session.preview.syncStatus === "pending") {
    return t("dialog.previewStatus.pending");
  }
  if (session.preview.syncStatus === "error") {
    return t("dialog.previewStatus.error");
  }
  return t("dialog.previewStatus.synced");
}

function ReviewPreviewPane({
  draft,
  session,
}: {
  draft: TailorReviewDraft;
  session: TailoringEditSession;
}): ReactElement {
  return (
    <div className="h-full min-h-[32rem]">
      <PdfPreview
        pdfUrl={session.preview.url}
        jobTitle={draft.job.title}
        downloadFilename={getDownloadFilename(draft, session)}
        isRefreshing={session.busy.refreshing}
        isPending={session.preview.syncStatus === "pending"}
        autoRefresh={false}
        lastRefreshedAt={session.preview.lastRefreshedAt}
        onRefresh={async () => {
          await session.preview.refresh();
        }}
      />
    </div>
  );
}

function getDownloadFilename(
  draft: TailorReviewDraft,
  session: TailoringEditSession,
): string {
  return (
    draft.pdfName?.trim() ||
    buildPdfFilename(
      null,
      draft.job.title,
      session.document.target === "cover" ? "cl" : "cv",
    )
  );
}

function ReviewDialogFooter({
  session,
  onClose,
  onFinalize,
}: SessionViewProps & {
  onClose: () => void;
  onFinalize: () => void;
}): ReactElement {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-card/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_48px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl sm:px-5 md:flex-row md:items-center md:justify-between md:px-7">
      <PreviewHelp session={session} />
      <ReviewActionButtons
        session={session}
        onClose={onClose}
        onFinalize={onFinalize}
      />
    </div>
  );
}

function PreviewHelp({ session }: SessionViewProps): ReactElement {
  const t = useTranslations("tailor");
  return (
    <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
      <FileText className="h-4 w-4 text-brand-emerald-text" aria-hidden />
      <span className="hidden sm:inline">
        {session.preview.syncStatus === "pending"
          ? t("dialog.previewHelpPending")
          : t("dialog.previewHelpReady")}
      </span>
      <span className="sm:hidden">{t("dialog.previewHelpMobile")}</span>
    </div>
  );
}

function ReviewActionButtons({
  session,
  onClose,
  onFinalize,
}: SessionViewProps & {
  onClose: () => void;
  onFinalize: () => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:justify-end">
      <ReviewDiscardButton session={session} />
      <ReviewCloseButton session={session} onClose={onClose} />
      <ReviewFinalizeButton session={session} onFinalize={onFinalize} />
    </div>
  );
}

function ReviewDiscardButton({ session }: SessionViewProps): ReactElement {
  const t = useTranslations("tailor");
  const disabled =
    session.busy.discarding || session.busy.finalizing || session.busy.exiting;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void session.discard()}
      disabled={disabled}
      className="min-h-11 touch-manipulation rounded-full border-border bg-card px-4 text-sm font-semibold text-foreground/85 shadow-sm transition-all hover:-translate-y-px hover:bg-muted/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none"
    >
      <RotateCcw className="h-4 w-4" aria-hidden />
      {session.busy.discarding
        ? t("dialog.discarding")
        : t("dialog.discard")}
    </Button>
  );
}

function ReviewCloseButton({
  session,
  onClose,
}: SessionViewProps & {
  onClose: () => void;
}): ReactElement {
  const t = useTranslations("tailor");
  const canClose = canCloseReview(session);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={canClose ? onClose : undefined}
      disabled={!canClose}
      className="min-h-11 touch-manipulation rounded-full border-border bg-card px-4 text-sm font-semibold text-foreground/85 shadow-sm transition-all hover:-translate-y-px hover:bg-muted/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none"
    >
      {session.busy.exiting ? t("dialog.saving") : t("dialog.close")}
    </Button>
  );
}

function ReviewFinalizeButton({
  session,
  onFinalize,
}: SessionViewProps & {
  onFinalize: () => void;
}): ReactElement {
  const t = useTranslations("tailor");
  const disabled =
    session.busy.finalizing ||
    session.busy.discarding ||
    session.busy.exiting ||
    session.busy.refreshing;
  const target =
    session.document.target === "resume"
      ? t("dialog.targetResume")
      : t("dialog.targetCover");
  return (
    <Button
      type="button"
      size="sm"
      onClick={onFinalize}
      disabled={disabled}
      className={cn(
        "col-span-2 min-h-11 touch-manipulation rounded-full border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_-16px_rgba(16,185,129,0.85)] transition-all hover:-translate-y-px hover:border-brand-emerald-600 hover:bg-brand-emerald-600 hover:shadow-[0_18px_34px_-16px_rgba(16,185,129,0.95)] focus-visible:ring-2 focus-visible:ring-ring sm:col-auto motion-reduce:transform-none motion-reduce:transition-none",
        "disabled:border-border disabled:bg-muted disabled:text-muted-foreground",
      )}
    >
      {session.busy.finalizing
        ? t("dialog.finalizing")
        : t("dialog.finalize", { target })}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function ReloadConflictDialog(): ReactElement {
  return (
    <ConflictDialog
      onReload={() => window.location.reload()}
      onOverwrite={() => window.location.reload()}
    />
  );
}

function StatusPill({
  status,
  label,
}: {
  status: "DRAFT" | "FINAL";
  label: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold uppercase tracking-wider",
        status === "FINAL"
          ? "bg-brand-emerald-100 text-brand-emerald-800"
          : "bg-amber-100 text-amber-800",
      )}
    >
      {label}
    </span>
  );
}
