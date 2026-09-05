"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import dynamic from "next/dynamic";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight, ClipboardList, Sparkles, Trash2 } from "lucide-react";
import { externalJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { useMarket } from "@/hooks/useMarket";
import { Button } from "@/components/ui/button";
import {
  COARSE_POINTER_MIN_HEIGHT,
  COARSE_POINTER_TARGET,
} from "@/components/ui/touchTarget";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  projectVisibleJobExperience,
  type JobExperienceAnalysis,
} from "@/lib/shared/jobExperienceAnalysis";
import {
  JOB_STATUS_LABEL_KEYS,
  type JobItem,
  type JobStatus,
  type CvSource,
  type CoverSource,
} from "../types";
import { selectableJobStatuses } from "@/lib/shared/jobStatus";
import { jobStatusPresentation } from "../utils/jobStatusPresentation";
import { jobTypeLabelKey, sentenceCase } from "../utils/jobFactLabels";
import { splitTitleQualifier } from "../utils/splitTitleQualifier";
import { JobRequirementsPanel } from "./JobRequirementsPanel";

// Markdown body (react-markdown + rehype-highlight + highlight.js CSS) is the
// jobs-list's heaviest dep cluster — load it as a dynamic chunk only when a
// job's description actually renders.
const JobDescriptionMarkdown = dynamic(
  () =>
    import("./JobDescriptionMarkdown").then((m) => m.JobDescriptionMarkdown),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-2">
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    ),
  },
);

interface JobDetailPanelProps {
  panelProps?: Omit<ComponentPropsWithoutRef<"div">, "className">;
  selectedJob: JobItem | null;
  selectedDescription: string;
  experienceAnalysis?: JobExperienceAnalysis | null;
  detailError: string | null;
  detailLoading: boolean;
  showLoadingOverlay: boolean;
  tailorSource?: { cv?: CvSource; cover?: CoverSource };
  updatingIds: Set<string>;
  deletingIds: Set<string>;
  mobileTab: "list" | "detail";
  onUpdateStatus: (id: string, status: JobStatus) => void;
  onDelete: (job: JobItem) => void;
  /**
   * Open the one tailoring surface. The target only picks which document the
   * dialog lands on; both are reachable from inside it.
   */
  onTailor: (job: JobItem, target: "resume" | "cover") => void;
  onRetryDetail: () => void;
}

/**
 * Feeds ship literal placeholders ("not applicable", "unknown") in jobType and
 * jobLevel — the absence of a value dressed as one. Same rule as the list rows.
 */
const PLACEHOLDER_FACT = /^(not applicable|unknown|n\/a|none)$/i;

function visibleFact(value?: string | null): string | null {
  const text = value?.trim();
  if (!text || PLACEHOLDER_FACT.test(text)) return null;
  return text;
}

/**
 * One entry in the header's property strip.
 *
 * The strip replaced a row of eight identical bordered chips. Boxes are what
 * made every property equal: the employer, the words "fulltime" and the posted
 * date all carried the same border, fill and icon, so the row had no first
 * read. As plain text separated by middots, weight is available again — and it
 * is spent on exactly one fact, the salary, which is the number people compare
 * postings on.
 */
type HeaderFact = {
  key: string;
  text: string;
  /** Only where the label is not obvious from the value itself. */
  srLabel?: string;
  className?: string;
};

interface SavedDocumentButtonProps {
  label: string;
  href: string;
  className: string;
  /** Null when the row predates Applications and only the PDF survives. */
  onOpenTailor: (() => void) | null;
}

/**
 * A published document is an entry point back into tailoring, not a download.
 * Without an Application behind it there is nothing to reopen, so the same
 * control degrades to a plain link to the stored PDF.
 */
function SavedDocumentButton({
  label,
  href,
  className,
  onOpenTailor,
}: SavedDocumentButtonProps) {
  // Tinted, not bordered. A published CV is Tailor's own output, so it sits one
  // step below the filled Tailor button and one step above the ghost link that
  // leaves the product — a bordered control here read as a form field beside it.
  const shared = cn("w-full justify-center", className);
  if (!onOpenTailor) {
    return (
      <Button variant="secondary" size="sm" asChild className={shared}>
        <a href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onOpenTailor}
      className={shared}
    >
      {label}
    </Button>
  );
}

/**
 * Memoized: this is the heaviest subtree on the page (markdown render,
 * requirements panel). Every prop is either data derived from the selected
 * job or a useCallback-stable handler, so parent keystrokes skip it.
 */
export const JobDetailPanel = React.memo(function JobDetailPanel({
  panelProps,
  selectedJob,
  selectedDescription,
  experienceAnalysis,
  detailError,
  detailLoading,
  showLoadingOverlay,
  tailorSource,
  updatingIds,
  deletingIds,
  mobileTab,
  onUpdateStatus,
  onDelete,
  onTailor,
  onRetryDetail,
}: JobDetailPanelProps) {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const tailorSourceLabel = (source: CvSource | CoverSource) => {
    switch (source) {
      case "ai":
      case "local_ai":
        return t("tailorSourceAi");
      case "manual_import":
        return t("tailorSourceManual");
      case "base":
        return t("tailorSourceBase");
      case "fallback":
        return t("tailorSourceFallback");
    }
  };
  // CN market ships a single Chinese résumé end-to-end — no AI CV tailoring or
  // cover-letter generation — so those actions are hidden there.
  const isCN = useMarket() === "CN";
  // Label, colour and the Select's own value all come from one projection, so
  // a row still carrying a status ADR-0007 retired cannot render its retired
  // name on an active colour, or seed the Select with a value absent from its
  // options.
  const statusPresentation = selectedJob
    ? jobStatusPresentation(selectedJob.status)
    : null;
  const visibleExperience = useMemo(
    () => projectVisibleJobExperience(selectedDescription, experienceAnalysis),
    [selectedDescription, experienceAnalysis],
  );
  // Reset the description scroll to the top when the selected job changes —
  // the ScrollArea viewport DOM node is reused across selections, so without
  // this a new job opens stuck at the previous job's scroll offset.
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusAfterDeleteRef = useRef(false);
  useEffect(() => {
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = 0;
  }, [selectedJob?.id]);

  useEffect(() => {
    if (!focusAfterDeleteRef.current) return;
    focusAfterDeleteRef.current = false;
    (titleRef.current ?? panelRootRef.current)?.focus();
  }, [selectedJob?.id]);

  const listOpacityClass = showLoadingOverlay ? "opacity-70" : "opacity-100";
  // One height for every control at every status. The toolbar used to shrink
  // from h-10 to h-9 when a job was marked Applied, so choosing a status made
  // the row it lives in jump.
  const actionHeight = cn("h-11 rounded-xl px-4 text-sm font-medium hover:translate-y-0 active:scale-[0.98] before:hidden", COARSE_POINTER_MIN_HEIGHT);

  const titleParts = useMemo(
    () => splitTitleQualifier(selectedJob?.title ?? ""),
    [selectedJob?.title],
  );

  const facts = useMemo((): HeaderFact[] => {
    if (!selectedJob) return [];
    const out: HeaderFact[] = [];
    const push = (fact: HeaderFact | null) => {
      if (fact) out.push(fact);
    };
    // The employer is the one fact that is not about the job, so it leads
    // and takes the brand colour: it stays the anchor of the header without
    // holding a row, a monogram tile and a whole line of its own.
    push({
      key: "company",
      text: visibleFact(selectedJob.company) ?? t("unknownCompany"),
      srLabel: t("company"),
      className: "font-medium text-brand-emerald-text",
    });
    const location = visibleFact(selectedJob.location);
    push(
      location
        ? { key: "location", text: location, srLabel: t("location") }
        : null,
    );
    const arrangement = visibleFact(selectedJob.workArrangement);
    push(
      arrangement
        ? { key: "arrangement", text: sentenceCase(arrangement) }
        : null,
    );
    const rawType = visibleFact(selectedJob.jobType);
    if (rawType) {
      const key = jobTypeLabelKey(rawType);
      // An unrecognised value is shown as the posting wrote it: a fact the
      // employer stated beats a tidy blank.
      push({
        key: "type",
        text: key ? t(key) : sentenceCase(rawType),
        srLabel: t("type"),
      });
    }
    const level = visibleFact(selectedJob.jobLevel);
    push(level ? { key: "level", text: sentenceCase(level) } : null);
    const salary = visibleFact(selectedJob.salary);
    push(
      salary
        ? {
            key: "salary",
            text: salary,
            className: "font-medium tabular-nums text-foreground",
          }
        : null,
    );
    if (selectedJob.livenessStatus === "EXPIRED") {
      push({
        key: "liveness",
        text: t("livenessExpired"),
        // Same hue the list row gives this signal, without the chip around it.
        className: "font-medium text-rose-800 dark:text-rose-300",
      });
    } else if (selectedJob.livenessStatus === "UNCERTAIN") {
      push({
        key: "liveness",
        text: t("livenessUncertain"),
        className: "font-medium text-amber-800 dark:text-amber-300",
      });
    }
    if (selectedJob.listingDate) {
      push({
        key: "posted",
        text: t("postedDate", {
          date: format.dateTime(new Date(selectedJob.listingDate), {
            day: "numeric",
            month: "short",
          }),
        }),
        className: "text-muted-foreground/80",
      });
    }
    return out;
  }, [selectedJob, t, format]);

  return (
    <div
      {...panelProps}
      ref={panelRootRef}
      tabIndex={-1}
      hidden={undefined}
      data-testid="jobs-details-panel"
      className={cn(
        "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
        "rounded-2xl border border-border/70 bg-background/90 shadow-sm",
        "lg:rounded-2xl lg:bg-background",
        "min-h-[clamp(18rem,calc(100dvh-16rem),32rem)] max-h-[calc(100dvh-12rem)] lg:h-auto lg:min-h-0 lg:max-h-none lg:flex-1",
        mobileTab !== "detail" && "hidden lg:flex",
      )}
    >
      {/* Top accent hairline — premium emerald sheen across the panel edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-brand-emerald-400/70 to-transparent"
      />

      <div className="relative shrink-0 border-b border-border/70 bg-gradient-to-br from-muted/45 via-background to-background px-5 pb-4 pt-4 sm:px-7">
        {selectedJob ? (
          <div className="relative flex flex-col">
            {/* The role and its pipeline state share the top line. The
                employer used to hold this row on its own, behind a monogram
                tile repeating its first letter; it now leads the fact strip
                below, which costs no row at all. */}
            <div className="flex items-start justify-between gap-4">
              <h2
                ref={titleRef}
                tabIndex={-1}
                className="min-w-0 flex-1 rounded-md text-balance text-xl font-semibold leading-[1.25] tracking-tight text-foreground [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 sm:text-2xl"
              >
                {titleParts.main}
                {titleParts.qualifier ? (
                  <>
                    {" "}
                    <span className="mt-1.5 block text-sm font-normal leading-5 tracking-normal text-muted-foreground">
                      {titleParts.qualifier}
                    </span>
                  </>
                ) : null}
              </h2>
              <Select
                value={statusPresentation?.status}
                onValueChange={(v) =>
                  onUpdateStatus(selectedJob.id, v as JobStatus)
                }
                disabled={updatingIds.has(selectedJob.id)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("status")}
                  className={cn(
                    "h-9 w-auto shrink-0 gap-2 rounded-full border border-border/80 bg-background px-3 text-xs font-medium text-foreground/80 shadow-xs",
                    "hover:bg-muted/70 hover:text-foreground data-[state=open]:bg-muted/70",
                    "dark:bg-background dark:hover:bg-muted/50",
                    "[&_svg]:size-3.5 [&_svg]:opacity-60",
                    COARSE_POINTER_MIN_HEIGHT,
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full transition-colors duration-[var(--dur-fast)]",
                      statusPresentation?.dotClass,
                    )}
                  />
                  <span className="truncate">
                    {statusPresentation ? t(statusPresentation.labelKey) : null}
                  </span>
                </SelectTrigger>
                <SelectContent align="end">
                  {selectableJobStatuses(selectedJob.status).map((status) => (
                    <SelectItem key={status} value={status}>
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          jobStatusPresentation(status).dotClass,
                        )}
                      />
                      {t(JOB_STATUS_LABEL_KEYS[status])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Row 2 — the facts, uniformly quiet except the one people
                compare postings on. Omitted entirely when nothing survives the
                placeholder filter, so there is no orphan gap. */}
            {facts.length ? (
              <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-muted-foreground">
                {facts.map((fact, index) => (
                  <React.Fragment key={fact.key}>
                    {index > 0 ? (
                      <span
                        aria-hidden
                        className="select-none text-foreground/25"
                      >
                        ·
                      </span>
                    ) : null}
                    {fact.srLabel ? (
                      <span className="sr-only">{fact.srLabel}: </span>
                    ) : null}
                    <span className={fact.className}>{fact.text}</span>
                  </React.Fragment>
                ))}
              </p>
            ) : null}

            {/* A dedicated action rail separates workflow from job facts. */}
            <div
              data-testid="job-primary-actions"
              className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3.5"
            >
              {/* CN ships a single Chinese resume with no tailoring, so it gets
                  no entry point at all. */}
              {!isCN ? (
                <Button
                  size="sm"
                  data-testid="job-tailor-button"
                  onClick={() => onTailor(selectedJob, "resume")}
                  className={cn(
                    "min-w-[132px] flex-1 justify-center border border-brand-emerald-700/30 bg-brand-emerald-700 text-white shadow-[0_2px_4px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-brand-emerald-800 hover:shadow-sm sm:flex-none",
                    actionHeight,
                  )}
                >
                  <Sparkles aria-hidden />
                  {t("tailorAction")}
                </Button>
              ) : null}
              {!isCN && selectedJob.resumePdfUrl ? (
                <SavedDocumentButton
                  label={t("savedCv")}
                  href={selectedJob.resumePdfUrl}
                  className={cn(actionHeight, "sm:w-auto")}
                  onOpenTailor={
                    selectedJob.applicationId
                      ? () => onTailor(selectedJob, "resume")
                      : null
                  }
                />
              ) : null}
              {!isCN && selectedJob.coverPdfUrl ? (
                <SavedDocumentButton
                  label={t("savedCl")}
                  href={selectedJob.coverPdfUrl}
                  className={cn(actionHeight, "sm:w-auto")}
                  onOpenTailor={
                    selectedJob.applicationId
                      ? () => onTailor(selectedJob, "cover")
                      : null
                  }
                />
              ) : null}
              <div className="flex flex-1 items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  // Tinted rather than filled. This opens the source
                  // posting, so it carries the blue those boards are known by
                  // and reads as its own kind of action next to Tailor — but
                  // a second filled surface would put the link that leaves the
                  // product at the same weight as the one that moves an
                  // application forward, which is the balance this header was
                  // rebuilt to fix.
                  className={cn(
                    "justify-center border-brand-blue/30 bg-brand-blue/[0.06] font-medium text-brand-blue shadow-xs transition-colors hover:border-brand-blue/50 hover:bg-brand-blue/[0.12] hover:text-brand-blue hover:shadow-xs dark:bg-brand-blue/10 dark:hover:bg-brand-blue/20",
                    actionHeight,
                  )}
                >
                  <a
                    href={externalJobUrl(selectedJob.jobUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("openJob")}
                    <ArrowUpRight className="size-3.5 opacity-70" aria-hidden />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("remove")}
                  title={t("remove")}
                  data-testid="job-remove-button"
                  disabled={deletingIds.has(selectedJob.id)}
                  onClick={() => {
                    focusAfterDeleteRef.current = true;
                    onDelete(selectedJob);
                  }}
                  // A borderless glyph gave the one destructive action on
                  // the row the weakest affordance on it: nothing said it was
                  // a control until the pointer was already there. It now
                  // carries the same border and height as Open job beside it,
                  // and only turns destructive on approach.
                  className={cn(
                    "ml-auto size-11 shrink-0 rounded-xl border border-border/70 bg-background text-muted-foreground shadow-xs transition-colors hover:translate-y-0 hover:shadow-none before:hidden hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-50",
                    COARSE_POINTER_TARGET,
                  )}
                >
                  <Trash2 className="size-[18px]" aria-hidden />
                </Button>
              </div>
            </div>

            {/* Row 5 — provenance is a footnote. Each string stays one text
                node so a whole-string query still matches it. */}
            {tailorSource ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {tailorSource.cv ? (
                  <span>
                    {t("tailorSourceCv", {
                      source: tailorSourceLabel(tailorSource.cv),
                    })}
                  </span>
                ) : null}
                {tailorSource.cv && tailorSource.cover ? (
                  <span aria-hidden className="select-none text-foreground/25">
                    ·
                  </span>
                ) : null}
                {tailorSource.cover ? (
                  <span>
                    {t("tailorSourceCover", {
                      source: tailorSourceLabel(tailorSource.cover),
                    })}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="relative text-sm text-muted-foreground">
            {t("selectJobToPreview")}
          </div>
        )}
      </div>
      <ScrollArea
        ref={scrollRootRef}
        type="scroll"
        data-testid="jobs-details-scroll"
        data-loading={showLoadingOverlay ? "true" : "false"}
        className={`jobs-scroll-area max-h-full flex-1 min-h-0 transition-opacity duration-200 ease-out ${listOpacityClass}`}
      >
        <div className="px-5 pb-10 pt-5 sm:px-7">
          {selectedJob ? (
            <div className="space-y-5 text-sm text-muted-foreground">
              <JobRequirementsPanel
                experience={visibleExperience}
                description={selectedDescription}
              />
              <div className="flex items-center gap-3 border-t border-border/70 pt-5">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("jobDescriptionTitle")}
                </h3>
              </div>
              {detailError ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <span>{detailError}</span>
                  <button
                    type="button"
                    onClick={onRetryDetail}
                    className={cn(
                      "font-semibold underline underline-offset-2 hover:no-underline",
                      COARSE_POINTER_MIN_HEIGHT,
                    )}
                  >
                    {t("retry")}
                  </button>
                </div>
              ) : null}
              {detailLoading ? (
                <div className="space-y-3 rounded-lg border border-dashed border-border/60 bg-transparent p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <div className="max-w-[70ch] text-foreground/85 [overflow-wrap:anywhere]">
                  {selectedDescription ? (
                    <JobDescriptionMarkdown
                      description={selectedDescription}
                      experience={visibleExperience}
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t("noJobDescription")}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Premium empty state — a medallion + copy instead of a bare line,
            // so the panel reads as "designed" before a job is selected.
            <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-emerald-50 to-brand-emerald-100 text-brand-emerald-600 shadow-[0_16px_32px_-18px_rgba(5,150,105,0.5)] ring-1 ring-brand-emerald-100 dark:from-brand-emerald-500/10 dark:to-brand-emerald-500/5 dark:text-brand-emerald-300">
                <ClipboardList className="h-6 w-6" aria-hidden />
              </span>
              <p className="max-w-[18rem] text-sm text-muted-foreground">
                {t("selectJobHint")}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
