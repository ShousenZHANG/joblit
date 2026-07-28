"use client";

import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, RotateCcw, X } from "lucide-react";
import {
  DocumentWorkbench,
  type DocumentWorkbenchPane,
} from "@/components/document/DocumentWorkbench";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ConflictDialog } from "./ConflictDialog";
import { DocumentTargetTabs } from "./DocumentTargetTabs";
import { PdfPreview } from "./PdfPreview";
import { ReviewGateCard } from "./ReviewGateCard";
import { SaveIndicator } from "./SaveIndicator";
import { TailoringProposalEditor } from "./TailoringProposalEditor";
import type { TailoringEditSession } from "./useTailoringEditSession";

export type TailorJob = {
  id: string | null;
  title: string;
  company: string | null;
  location: string | null;
  market: string;
};

type TailorClientViewProps = {
  session: TailoringEditSession;
  resumePdfName: string;
  coverPdfName: string;
  job: TailorJob;
  onBack: () => void;
  onFinalize: () => void;
};

type TailorDocumentProps = Pick<
  TailorClientViewProps,
  "session" | "resumePdfName" | "coverPdfName" | "job"
> & {
  pane: DocumentWorkbenchPane;
  onPaneChange: (pane: DocumentWorkbenchPane) => void;
  interactionLocked: boolean;
};

export function TailorClientView({
  session,
  resumePdfName,
  coverPdfName,
  job,
  onBack,
  onFinalize,
}: TailorClientViewProps): ReactElement {
  const [pane, setPane] = useState<DocumentWorkbenchPane>("editor");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const interactionLocked = isInteractionLocked(session);

  return (
    <div className="cosmos-focus mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 pb-32 pt-6 lg:px-8">
      <TailorHeader
        session={session}
        job={job}
        onBack={onBack}
        interactionLocked={interactionLocked}
      />
      <TailorDocument
        session={session}
        resumePdfName={resumePdfName}
        coverPdfName={coverPdfName}
        job={job}
        pane={pane}
        onPaneChange={setPane}
        interactionLocked={interactionLocked}
      />
      <TailorActionBar
        session={session}
        onDiscard={() => setDiscardDialogOpen(true)}
        onFinalize={onFinalize}
      />
      <TailorOverlays
        session={session}
        discardDialogOpen={discardDialogOpen}
        onDiscardDialogChange={setDiscardDialogOpen}
      />
    </div>
  );
}

function isInteractionLocked(session: TailoringEditSession): boolean {
  return session.busy.finalizing || session.busy.discarding || session.busy.exiting;
}

function TailorHeader({
  session,
  job,
  onBack,
  interactionLocked,
}: {
  session: TailoringEditSession;
  job: TailorJob;
  onBack: () => void;
  interactionLocked: boolean;
}): ReactElement {
  return (
    <header className="flex flex-wrap items-center gap-4">
      <BackButton onBack={onBack} disabled={interactionLocked} />
      <JobHeading job={job} />
      <SessionStatus session={session} />
    </header>
  );
}

function BackButton({
  onBack,
  disabled,
}: {
  onBack: () => void;
  disabled: boolean;
}): ReactElement {
  const t = useTranslations("tailor");
  return (
    <button
      type="button"
      onClick={onBack}
      disabled={disabled}
      className="inline-flex min-h-11 min-w-11 touch-manipulation items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t("backToJobs")}
    </button>
  );
}

function JobHeading({ job }: { job: TailorJob }): ReactElement {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
        {job.title}
        {job.company ? (
          <span className="text-muted-foreground"> · {job.company}</span>
        ) : null}
      </h1>
      {job.location ? (
        <p className="truncate text-xs text-muted-foreground">{job.location}</p>
      ) : null}
    </div>
  );
}

function SessionStatus({
  session,
}: {
  session: TailoringEditSession;
}): ReactElement {
  const t = useTranslations("tailor");
  return (
    <div className="flex items-center gap-3">
      <StatusPill
        status={session.document.status}
        label={
          session.document.status === "FINAL"
            ? t("statusFinal")
            : t("statusDraft")
        }
      />
      <SaveIndicator
        status={session.content.saveStatus}
        onRetry={() => void session.content.retrySave()}
      />
    </div>
  );
}

function TailorDocument({
  session,
  resumePdfName,
  coverPdfName,
  job,
  pane,
  onPaneChange,
  interactionLocked,
}: TailorDocumentProps): ReactElement {
  const t = useTranslations("tailor");
  return (
    <DocumentTargetTabs
      target={session.document.target}
      onSelect={session.document.select}
      label={t("docTablistLabel")}
      labels={{ resume: t("docResume"), cover: t("docCover") }}
      disabled={interactionLocked}
    >
      <TailorIssueRegion session={session} />
      <ReviewGateCard
        review={session.issue.blockedReview ?? session.content.value.review}
      />
      <TailorWorkbench
        session={session}
        resumePdfName={resumePdfName}
        coverPdfName={coverPdfName}
        job={job}
        pane={pane}
        onPaneChange={onPaneChange}
        interactionLocked={interactionLocked}
      />
    </DocumentTargetTabs>
  );
}

function TailorIssueRegion({
  session,
}: {
  session: TailoringEditSession;
}): ReactElement | null {
  const t = useTranslations("tailor");
  if (!session.issue.message || session.issue.blockedReview) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="min-w-0">{session.issue.message}</span>
      <button
        type="button"
        onClick={session.issue.clear}
        aria-label={t("dismissError")}
        className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function TailorWorkbench({
  session,
  resumePdfName,
  coverPdfName,
  job,
  pane,
  onPaneChange,
  interactionLocked,
}: TailorDocumentProps): ReactElement {
  const t = useTranslations("tailor");
  return (
    <div
      data-testid="tailoring-workbench-region"
      aria-busy={interactionLocked}
      inert={interactionLocked ? true : undefined}
    >
      <DocumentWorkbench
        pane={pane}
        onPaneChange={onPaneChange}
        labels={{
          tablist: t("workbench.tablist"),
          editor: t("workbench.editor"),
          preview: t("workbench.preview"),
        }}
        editor={<TailorEditor session={session} />}
        preview={
          <TailorPreview
            session={session}
            jobTitle={job.title}
            resumePdfName={resumePdfName}
            coverPdfName={coverPdfName}
          />
        }
      />
    </div>
  );
}

function TailorEditor({
  session,
}: {
  session: TailoringEditSession;
}): ReactElement {
  return (
    <TailoringProposalEditor
      target={session.document.target}
      content={session.content.value}
      onUpdate={session.content.update}
    />
  );
}

function TailorPreview({
  session,
  jobTitle,
  resumePdfName,
  coverPdfName,
}: {
  session: TailoringEditSession;
  jobTitle: string;
  resumePdfName: string;
  coverPdfName: string;
}): ReactElement {
  const filename =
    session.document.target === "resume" ? resumePdfName : coverPdfName;
  return (
    <PdfPreview
      pdfUrl={session.preview.url}
      jobTitle={jobTitle}
      downloadFilename={filename}
      isRefreshing={session.busy.refreshing}
      isPending={session.preview.syncStatus === "pending"}
      lastRefreshedAt={session.preview.lastRefreshedAt}
      onRefresh={async () => {
        await session.preview.refresh();
      }}
    />
  );
}

function TailorActionBar({
  session,
  onDiscard,
  onFinalize,
}: {
  session: TailoringEditSession;
  onDiscard: () => void;
  onFinalize: () => void;
}): ReactElement {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:px-8">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-end gap-3">
        <DiscardTrigger session={session} onClick={onDiscard} />
        <FinalizeButton session={session} onClick={onFinalize} />
      </div>
    </div>
  );
}

function DiscardTrigger({
  session,
  onClick,
}: {
  session: TailoringEditSession;
  onClick: () => void;
}): ReactElement {
  const t = useTranslations("tailor");
  const disabled =
    session.busy.discarding || session.busy.finalizing || session.busy.exiting;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-full border border-border/70 bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-brand-emerald-300/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <RotateCcw className="h-4 w-4" aria-hidden />
      {session.busy.discarding ? t("discarding") : t("discardChanges")}
    </button>
  );
}

function FinalizeButton({
  session,
  onClick,
}: {
  session: TailoringEditSession;
  onClick: () => void;
}): ReactElement {
  const t = useTranslations("tailor");
  const disabled =
    session.busy.finalizing ||
    session.busy.discarding ||
    session.busy.exiting ||
    session.busy.refreshing;
  const doc = session.document.target === "resume" ? t("docResume") : t("docCover");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-semibold text-background shadow-[0_8px_20px_-8px_rgba(15,23,42,0.4)] transition-all hover:-translate-y-px hover:bg-foreground/90 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none",
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      {session.busy.finalizing ? t("finalizing") : t("finalizeDoc", { doc })}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </button>
  );
}

function TailorOverlays({
  session,
  discardDialogOpen,
  onDiscardDialogChange,
}: {
  session: TailoringEditSession;
  discardDialogOpen: boolean;
  onDiscardDialogChange: (open: boolean) => void;
}): ReactElement {
  const showConflict =
    session.content.saveStatus.kind === "error" &&
    session.content.saveStatus.conflict === true;
  return (
    <>
      {showConflict ? <ReloadConflictDialog /> : null}
      <DiscardChangesDialog
        open={discardDialogOpen}
        onOpenChange={onDiscardDialogChange}
        onDiscard={() => void session.discard()}
      />
    </>
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

function DiscardChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}): ReactElement {
  const t = useTranslations("tailor");
  const tc = useTranslations("common");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md rounded-2xl border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("discardConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("discardConfirmBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">
            {tc("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onDiscard}
            className="min-h-11 rounded-xl bg-destructive text-white hover:bg-destructive"
          >
            {t("discardChanges")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
