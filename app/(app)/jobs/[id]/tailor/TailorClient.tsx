"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw, X } from "lucide-react";
import { fetchJson, ApiError } from "@/lib/api/fetchJson";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { cn } from "@/lib/utils";
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
import { useTailorDraft } from "./useTailorDraft";
import { SaveIndicator } from "./SaveIndicator";
import { SummarySection } from "./SummarySection";
import { BulletsSection } from "./BulletsSection";
import { SkillsSection } from "./SkillsSection";
import { CoverParagraphsSection } from "./CoverParagraphsSection";
import { PdfPreview } from "./PdfPreview";
import { ConflictDialog } from "./ConflictDialog";

type DocTab = "resume" | "cover";
type ViewTab = "edit" | "preview";

interface TailorClientProps {
  applicationId: string;
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
    market: string;
  };
}

export function TailorClient({
  applicationId,
  initialStatus,
  initialAiContent,
  initialAiContentHash,
  resumePdfUrl,
  coverPdfUrl,
  job,
}: TailorClientProps) {
  const router = useRouter();
  const draft = useTailorDraft({
    applicationId,
    initialAiContent,
    initialAiContentHash,
  });

  const [docTab, setDocTab] = useState<DocTab>("resume");
  const [viewTab, setViewTab] = useState<ViewTab>("edit");
  const [status, setStatus] = useState<"DRAFT" | "FINAL">(initialStatus);
  const [resumePdf, setResumePdf] = useState<string | null>(resumePdfUrl);
  const [coverPdf, setCoverPdf] = useState<string | null>(coverPdfUrl);
  const [lastResumeRefreshAt, setLastResumeRefreshAt] = useState<number | null>(
    resumePdfUrl ? Date.now() : null,
  );
  const [lastCoverRefreshAt, setLastCoverRefreshAt] = useState<number | null>(
    coverPdfUrl ? Date.now() : null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  // Beforeunload guard: only warn if there are pending unsaved edits.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (
        draft.saveStatus.kind === "dirty" ||
        draft.saveStatus.kind === "saving"
      ) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [draft.saveStatus]);

  // Surface 409 saves as the conflict dialog (Phase 3).
  useEffect(() => {
    if (
      draft.saveStatus.kind === "error" &&
      draft.saveStatus.message.includes("Another tab")
    ) {
      setShowConflictDialog(true);
    }
  }, [draft.saveStatus]);

  function patchSummary(summary: AiContent["cv"]["summary"]) {
    draft.setAiContent({
      ...draft.aiContent,
      cv: { ...draft.aiContent.cv, summary },
    });
  }
  function patchLatestExperience(le: AiContent["cv"]["latestExperience"]) {
    draft.setAiContent({
      ...draft.aiContent,
      cv: { ...draft.aiContent.cv, latestExperience: le },
    });
  }
  function patchSkills(sa: AiContent["cv"]["skillsAdditions"]) {
    draft.setAiContent({
      ...draft.aiContent,
      cv: { ...draft.aiContent.cv, skillsAdditions: sa },
    });
  }
  function patchCover(cover: AiContent["cover"]) {
    draft.setAiContent({ ...draft.aiContent, cover });
  }

  async function callFinalize(target: DocTab) {
    const expectedHash = await draft.flushNow();
    const json = await fetchJson<undefined>(
      `/api/applications/${applicationId}/finalize?target=${target}`,
      {
        method: "POST",
        body: JSON.stringify({ expectedHash }),
      },
    );
    return json as {
      status: "FINAL";
      resumePdfUrl?: string;
      coverPdfUrl?: string;
    };
  }

  async function handleRefresh() {
    setActionError(null);
    setIsRefreshing(true);
    try {
      const data = await callFinalize(docTab);
      if (docTab === "resume" && data.resumePdfUrl) {
        setResumePdf(data.resumePdfUrl);
        setLastResumeRefreshAt(Date.now());
      } else if (docTab === "cover" && data.coverPdfUrl) {
        setCoverPdf(data.coverPdfUrl);
        setLastCoverRefreshAt(Date.now());
      }
      setStatus("FINAL");
    } catch (err: unknown) {
      setActionError(extractMessage(err, "Refresh failed"));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleFinalize() {
    setActionError(null);
    setIsFinalizing(true);
    try {
      const data = await callFinalize(docTab);
      if (data.resumePdfUrl) setResumePdf(data.resumePdfUrl);
      if (data.coverPdfUrl) setCoverPdf(data.coverPdfUrl);
      setStatus("FINAL");
      router.push("/jobs");
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
        `/api/applications/${applicationId}/discard`,
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

  const currentPdf = docTab === "resume" ? resumePdf : coverPdf;
  const currentRefreshAt =
    docTab === "resume" ? lastResumeRefreshAt : lastCoverRefreshAt;

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 pb-32 pt-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-4">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to jobs
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {job.title}
            {job.company ? (
              <span className="text-muted-foreground"> · {job.company}</span>
            ) : null}
          </h1>
          {job.location ? (
            <p className="truncate text-xs text-muted-foreground">
              {job.location}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={status} />
          <SaveIndicator status={draft.saveStatus} />
        </div>
      </header>

      <DocTabs docTab={docTab} setDocTab={setDocTab} />

      {/* Mobile Edit/Preview switcher (only visible <lg). */}
      <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background p-1 lg:hidden">
        <ViewTabBtn active={viewTab === "edit"} onClick={() => setViewTab("edit")}>
          Edit
        </ViewTabBtn>
        <ViewTabBtn
          active={viewTab === "preview"}
          onClick={() => setViewTab("preview")}
        >
          Preview
        </ViewTabBtn>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <span className="min-w-0">{actionError}</span>
          {/* Dismiss — otherwise a stale error hangs over the editor for the
              rest of the session. */}
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-destructive/15"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div
          className={cn(
            "flex flex-col gap-4",
            viewTab === "preview" && "hidden lg:flex",
          )}
        >
          {docTab === "resume" ? (
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

        <div
          className={cn(
            viewTab === "edit" && "hidden lg:block",
          )}
        >
          <PdfPreview
            pdfUrl={currentPdf}
            jobTitle={job.title}
            isRefreshing={isRefreshing}
            lastRefreshedAt={currentRefreshAt}
            onRefresh={handleRefresh}
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setDiscardDialogOpen(true)}
            disabled={isDiscarding}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-full border border-border/70 bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-brand-emerald-300/60 hover:bg-muted",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {isDiscarding ? "Discarding…" : "Discard changes"}
          </button>
          <button
            type="button"
            onClick={handleFinalize}
            disabled={isFinalizing}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-semibold text-background shadow-[0_8px_20px_-8px_rgba(15,23,42,0.4)] transition-all hover:-translate-y-px hover:bg-foreground/90 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,0.5)]",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            {isFinalizing
              ? "Finalizing…"
              : `Finalize ${docTab === "resume" ? "Resume" : "Cover Letter"}`}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {showConflictDialog ? (
        <ConflictDialog
          onReload={() => {
            window.location.reload();
          }}
          onOverwrite={() => {
            setShowConflictDialog(false);
            // Force a re-save by replacing the hash with current server hash.
            // Simplest: reload — overwrite semantics are dangerous without
            // an explicit server endpoint. Phase 4 may add /draft?force=true.
            window.location.reload();
          }}
        />
      ) : null}

      <AlertDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <AlertDialogContent className="max-w-md rounded-2xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard draft changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This resets the draft to the original AI proposal. Your current
              edits in this review step will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDiscard()}
              className="rounded-xl bg-destructive text-white hover:bg-destructive"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function DocTabs({
  docTab,
  setDocTab,
}: {
  docTab: DocTab;
  setDocTab: (v: DocTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Document"
      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background p-1"
    >
      <DocTabBtn
        active={docTab === "resume"}
        onClick={() => setDocTab("resume")}
      >
        Resume
      </DocTabBtn>
      <DocTabBtn
        active={docTab === "cover"}
        onClick={() => setDocTab("cover")}
      >
        Cover Letter
      </DocTabBtn>
    </div>
  );
}

function DocTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full px-4 text-xs font-semibold transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ViewTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 flex-1 items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
