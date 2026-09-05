"use client";

import { useEffect, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { ConflictDialog } from "./ConflictDialog";
import { CoverParagraphsSection } from "./CoverParagraphsSection";
import { SaveIndicator } from "./SaveIndicator";
import { SkillsSelectionPanel } from "./SkillsSelectionPanel";
import { SummarySection } from "./SummarySection";
import { TailorLockedSteps } from "./TailorLockedSteps";
import { TailorStep } from "./TailorStep";
import type { TailorTarget } from "./tailorActions";
import type {
  TailorPhase,
  TailorReviewDraft,
  TailorReviewFinalized,
} from "./tailorDialogTypes";
import {
  useTailoringEditSession,
  type TailoringEditSession,
} from "./useTailoringEditSession";

interface TailorDraftStepsProps {
  onPublicationChange: (publication: ApplicationPublication) => void;
  sessionRef: RefObject<TailoringEditSession | null>;
  onEditStateChange: (state: { busy: boolean; unsaved: boolean }) => void;
  disabled: boolean;
  draft: TailorReviewDraft;
  target: TailorTarget;
  expandedPhase: TailorPhase | "none";
  onExpandPhase: (phase: Extract<TailorPhase, "review" | "publish">) => void;
  onFinalized: (result: TailorReviewFinalized) => void;
}

type PdfUrls = Record<TailorTarget, string | null>;

/**
 * Phases three and four: edit what the model returned, then publish it.
 *
 * Mounted once per Application and pointed at whichever document the tabs
 * select, because both documents share one autosaving draft — remounting per
 * target would drop pending edits on every tab switch.
 */
export function TailorDraftSteps({
  sessionRef,
  onPublicationChange,
  onEditStateChange,
  disabled,
  draft,
  target,
  expandedPhase,
  onExpandPhase,
  onFinalized,
}: TailorDraftStepsProps) {
  const t = useTranslations("tailor.dialog");
  const td = useTranslations("tailor");
  const session = useTailorSession(draft, target);
  useEffect(() => {
    sessionRef.current = session;
    return () => { sessionRef.current = null; };
  }, [session, sessionRef]);
  useEffect(() => { onPublicationChange(session.document.publication); }, [session.document.publication, onPublicationChange]);
  const busy = session.busy.finalizing || session.busy.discarding || session.busy.exiting;
  const unsaved = session.content.saveStatus.kind !== "saved";
  useEffect(() => { onEditStateChange({ busy, unsaved }); }, [busy, unsaved, onEditStateChange]);
  const [pdfUrls, setPdfUrls] = useState<PdfUrls>(() => ({
    resume: draft.resumePdfUrl,
    cover: draft.coverPdfUrl,
  }));

  useEffect(() => {
    session.document.select(target);
  }, [session.document, target]);

  const targetStatus = session.document.publication[target].status;
  const hasContent = targetStatus !== "MISSING";
  const published = targetStatus === "FINAL";
  const reviewState =
    expandedPhase === "review" ? "expanded" : published ? "done" : "future";
  const publishState =
    expandedPhase === "publish" ? "expanded" : published ? "done" : "future";
  const conflicted =
    session.content.saveStatus.kind === "error" &&
    session.content.saveStatus.conflict === true;

  async function publish() {
    const result = await session.finalize();
    if (!result) return;
    setPdfUrls((current) => ({
      resume: result.resumePdfUrl ?? current.resume,
      cover: result.coverPdfUrl ?? current.cover,
    }));
    onFinalized({
      target,
      resumePdfUrl: result.resumePdfUrl,
      resumePdfName: result.resumePdfName,
      coverPdfUrl: result.coverPdfUrl,
      coverPdfName: result.coverPdfName,
    });
  }

  if (!hasContent) return (
    <>
      {session.issue.message ? (
        <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{session.issue.message}</p>
      ) : null}
      <TailorLockedSteps />
    </>
  );

  const pdfLink = pdfUrls[target] ? (
    <a
      href={pdfUrls[target] ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-emerald-text underline-offset-4 hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      {t("openPdf")}
    </a>
  ) : null;

  return (
    <fieldset disabled={disabled || busy} className="min-w-0 space-y-3 border-0 p-0">
      {session.issue.message ? (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          <span className="min-w-0 py-1">{session.issue.message}</span>
          <button
            type="button"
            onClick={session.issue.clear}
            aria-label={td("dismissError")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <TailorStep
        index={1}
        state={reviewState}
        onExpand={() => onExpandPhase("review")}
        title={t("stepReviewTitle")}
        description={t("stepReviewBody")}
        action={
          <div className="flex items-center gap-2">
            <SaveIndicator
              status={session.content.saveStatus}
              onRetry={() => void session.content.retrySave()}
            />
            <button
              type="button"
              onClick={() => void session.discard()}
              disabled={session.busy.discarding || session.busy.finalizing}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              {session.busy.discarding ? t("discarding") : t("discard")}
            </button>
          </div>
        }
      >
        {target === "resume" ? (
          <ResumeReview draft={draft} session={session} />
        ) : (
          <CoverParagraphsSection
            cover={session.content.value.cover}
            onChange={(next) =>
              session.content.update((current) => ({ ...current, cover: next }))
            }
          />
        )}
        <div className="mt-5 flex justify-end border-t border-border/60 pt-4">
          <Button type="button" onClick={() => onExpandPhase("publish")} className="min-h-11 rounded-xl">{t("continuePublish")}</Button>
        </div>
      </TailorStep>

      <TailorStep
        index={2}
        state={publishState}
        onExpand={() => onExpandPhase("publish")}
        title={t("stepPublishTitle")}
        description={t("stepPublishBody")}
        summary={t("publishedSummary")}
        doneAside={pdfLink}
        action={
          <Button
            type="button"
            size="sm"
            disabled={session.busy.finalizing || session.busy.discarding}
            onClick={() => void publish()}
            className="h-11 rounded-xl bg-brand-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-700 disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none"
          >
            {session.busy.finalizing ? (
              <>
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                {t("finalizing")}
              </>
            ) : (
              t("finalize")
            )}
          </Button>
        }
      >
        {pdfLink}
      </TailorStep>

      {conflicted ? (
        <ConflictDialog
          onReload={() => window.location.reload()}
          onOverwrite={() => window.location.reload()}
        />
      ) : null}
    </fieldset>
  );
}

function ResumeReview({
  draft,
  session,
}: {
  draft: TailorReviewDraft;
  session: TailoringEditSession;
}) {
  const t = useTranslations("tailor.skills");
  const cv = session.content.value.cv;
  return (
    <div className="space-y-5">
      <SummarySection
        summary={cv.summary}
        onChange={(next) =>
          session.content.update((current) => patchCv(current, { summary: next }))
        }
      />
      <section className="space-y-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("title")}
        </h4>
        <SkillsSelectionPanel
          masterSkills={draft.masterSkills}
          selection={cv.skillsSelection}
          onChange={(next) =>
            session.content.update((current) =>
              patchCv(current, { skillsSelection: next }),
            )
          }
        />
      </section>
    </div>
  );
}

function patchCv(content: AiContent, patch: Partial<AiContent["cv"]>): AiContent {
  return { ...content, cv: { ...content.cv, ...patch } };
}

function useTailorSession(
  draft: TailorReviewDraft,
  initialTarget: TailorTarget,
): TailoringEditSession {
  const t = useTranslations("tailor");
  return useTailoringEditSession({
    applicationId: draft.applicationId,
    initialPublication: draft.initialPublication,
    initialAiContent: draft.initialAiContent,
    initialAiContentHash: draft.initialAiContentHash,
    initialTarget,
    messages: {
      conflict: t("save.conflict"),
      saveFailed: t("save.failedRetry"),
      finalizeFailed: t("dialog.errorFinalize"),
      discardFailed: t("dialog.errorDiscard"),
      exitFailed: t("dialog.errorSaveStillOpen"),
    },
  });
}
