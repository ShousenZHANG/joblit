"use client";

import React, { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import dynamic from "next/dynamic";
import { useFormatter, useTranslations } from "next-intl";
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  ClipboardPaste,
  DollarSign,
  ExternalLink,
  FileText,
  MapPin,
  MoreHorizontal,
  Trash2,
  Wifi,
} from "lucide-react";
import { useMarket } from "@/hooks/useMarket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COARSE_POINTER_MIN_HEIGHT } from "@/components/ui/touchTarget";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";
import type { JobExperienceAnalysis } from "@/lib/shared/jobExperienceAnalysis";
import {
  JOB_STATUS_LABEL_KEYS,
  type JobItem,
  type JobStatus,
  type CvSource,
  type CoverSource,
} from "../types";
import { selectableJobStatuses } from "@/lib/shared/jobStatus";
import { jobStatusPresentation } from "../utils/jobStatusPresentation";
import { JobRequirementsPanel } from "./JobRequirementsPanel";

// Markdown body (react-markdown + rehype-highlight + highlight.js CSS) is the
// jobs-list's heaviest dep cluster — load it as a dynamic chunk only when a
// job's description actually renders.
const JobDescriptionMarkdown = dynamic(
  () => import("./JobDescriptionMarkdown").then((m) => m.JobDescriptionMarkdown),
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
  selectedFitMatrix: FitMatrix | null;
  detailError: string | null;
  detailLoading: boolean;
  showLoadingOverlay: boolean;
  tailorSource?: { cv?: CvSource; cover?: CoverSource };
  updatingIds: Set<string>;
  deletingIds: Set<string>;
  highlightGenerate: boolean;
  guideHighlightClass: string;
  externalPromptLoading: boolean;
  mobileTab: "list" | "detail";
  onUpdateStatus: (id: string, status: JobStatus) => void;
  onDelete: (job: JobItem) => void;
  /** Zero-install fallback: copy the prompt, run it anywhere, paste JSON. */
  onManualGenerate: (job: JobItem, target: "resume" | "cover") => void;
  onRetryDetail: () => void;
}

/** Small icon + label pill for the header meta row. Renders nothing when the
 *  value is empty so the row stays tight. */
function MetaChip({ icon: Icon, value }: { icon: React.ElementType; value?: string | null }) {
  const text = value?.trim();
  // Source feeds ship literal placeholders ("not applicable", "unknown") in
  // jobType/jobLevel — the absence of a value, not a value. Same rule as the
  // list rows.
  if (!text || /^(not applicable|unknown|n\/a|none)$/i.test(text)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-xs font-medium text-foreground/75 shadow-sm">
      <Icon className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600 dark:text-brand-emerald-400" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
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
  selectedFitMatrix,
  detailError,
  detailLoading,
  showLoadingOverlay,
  tailorSource,
  updatingIds,
  deletingIds,
  highlightGenerate,
  guideHighlightClass,
  externalPromptLoading,
  mobileTab,
  onUpdateStatus,
  onDelete,
  onManualGenerate,
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
  // Reset the description scroll to the top when the selected job changes —
  // the ScrollArea viewport DOM node is reused across selections, so without
  // this a new job opens stuck at the previous job's scroll offset.
  const scrollRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = 0;
  }, [selectedJob?.id]);

  const isAppliedSelected = selectedJob?.status === "APPLIED";
  const listOpacityClass = showLoadingOverlay ? "opacity-70" : "opacity-100";
  const actionHeight = cn(
    isAppliedSelected ? "h-9" : "h-10",
    COARSE_POINTER_MIN_HEIGHT,
  );

  return (
    <div
      {...panelProps}
      hidden={undefined}
      data-testid="jobs-details-panel"
      className={cn(
        "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
        "rounded-2xl border border-border/70 bg-background/90 shadow-sm",
        "lg:rounded-3xl lg:border-2 lg:border-border/50 lg:bg-background/85 lg:shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] lg:hover:shadow-[0_24px_50px_-36px_rgba(5,150,105,0.22)]",
        "min-h-[clamp(18rem,calc(100dvh-16rem),32rem)] max-h-[calc(100dvh-12rem)] lg:h-auto lg:min-h-0 lg:max-h-none lg:flex-1",
        mobileTab !== "detail" && "hidden lg:flex",
      )}
    >
      {/* Top accent hairline — premium emerald sheen across the panel edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-brand-emerald-400/70 to-transparent"
      />

      <div className="relative border-b border-border/60 px-4 py-4">
        {/* Soft gradient wash behind the header for depth. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-emerald-50/60 via-transparent to-transparent dark:from-brand-emerald-500/[0.06]"
        />
        {selectedJob ? (
          // Always stack the info block above the action row — an earlier
          // flex-wrap layout sat actions inline for short titles and
          // wrapped to a new line for long ones, so the button row shifted
          // position per job. Forcing a two-row layout gives every job the
          // same "title / company → actions" rhythm.
          <div className="relative flex flex-col gap-3.5">
            <div className="space-y-2.5">
              {/* No status pill here: the Select below is the status
                  surface, and it can be edited — the pill was its read-only
                  echo two centimetres away. */}
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                {selectedJob.title}
              </h2>
              {/* Meta as icon chips — replaces the flat dotted text line for a
                  scannable, premium header. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <MetaChip icon={Building2} value={selectedJob.company} />
                <MetaChip icon={MapPin} value={selectedJob.location} />
                <MetaChip icon={Briefcase} value={selectedJob.jobType} />
                <MetaChip icon={BarChart3} value={selectedJob.jobLevel} />
                <MetaChip icon={DollarSign} value={selectedJob.salary} />
                <MetaChip icon={Wifi} value={selectedJob.workArrangement} />
                <MetaChip
                  icon={ClipboardList}
                  value={
                    selectedJob.livenessStatus === "EXPIRED"
                      ? t("livenessExpired")
                      : selectedJob.livenessStatus === "UNCERTAIN"
                        ? t("livenessUncertain")
                        : null
                  }
                />
                <MetaChip
                  icon={CalendarDays}
                  value={
                    selectedJob.listingDate
                      ? t("postedDate", {
                          date: format.dateTime(new Date(selectedJob.listingDate), {
                            day: "numeric",
                            month: "short",
                          }),
                        })
                      : null
                  }
                />
              </div>
            </div>
            <div className="w-full">
              <div
                data-testid="job-primary-actions"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center"
              >
                <Select
                  value={statusPresentation?.status}
                  onValueChange={(v) => onUpdateStatus(selectedJob.id, v as JobStatus)}
                  disabled={updatingIds.has(selectedJob.id)}
                >
                  <SelectTrigger
                    className={cn(
                      "rounded-xl border-border bg-background shadow-sm",
                      COARSE_POINTER_MIN_HEIGHT,
                      isAppliedSelected
                        ? "h-9 w-full px-3 text-sm sm:w-[118px]"
                        : "h-10 w-full sm:w-[132px]",
                    )}
                  >
                    <span className="truncate">
                      {statusPresentation ? t(statusPresentation.labelKey) : null}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {selectableJobStatuses(selectedJob.status).map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(JOB_STATUS_LABEL_KEYS[status])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Generation is not here any more. It belongs to the
                    shortlist, not to one row: the list toolbar queues every
                    NEW job in one press, which is how the triage-then-generate
                    loop actually runs. What stays are the things that are
                    genuinely about THIS job. */}
                <Button
                  asChild
                  size="sm"
                  className={`w-full justify-center rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_rgba(5,150,105,0.8)] transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 active:translate-y-[1px] sm:w-auto ${actionHeight} px-4`}
                >
                  <a href={selectedJob.jobUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" />
                    {t("openJob")}
                  </a>
                </Button>
                {!isCN ? (
                  /* Manual import is ADR-0015's zero-install floor: it must
                     stay reachable, but it is the exception, so it lives
                     behind the overflow rather than spending a labelled slot
                     in the primary row. */
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("moreActions")}
                        data-testid="job-detail-overflow"
                        className={`w-full justify-center rounded-xl text-foreground/60 transition-colors hover:bg-muted hover:text-foreground sm:w-9 ${actionHeight} px-0`}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        className="min-h-11"
                        onClick={() => onManualGenerate(selectedJob, "resume")}
                        disabled={externalPromptLoading}
                      >
                        <ClipboardPaste className="mr-2 h-4 w-4" aria-hidden />
                        {t("manualGenerateCv")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-11"
                        onClick={() => onManualGenerate(selectedJob, "cover")}
                        disabled={externalPromptLoading}
                      >
                        <ClipboardPaste className="mr-2 h-4 w-4" aria-hidden />
                        {t("manualGenerateCl")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {!isCN && selectedJob.resumePdfUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className={`w-full justify-center rounded-xl border-border bg-background text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted active:translate-y-[1px] sm:w-auto ${actionHeight} px-4`}
                  >
                    <a href={selectedJob.resumePdfUrl} target="_blank" rel="noreferrer">
                      {t("savedCv")}
                    </a>
                  </Button>
                ) : null}
                {!isCN && selectedJob.coverPdfUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className={`w-full justify-center rounded-xl border-border bg-background text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted active:translate-y-[1px] sm:w-auto ${actionHeight} px-4`}
                  >
                    <a href={selectedJob.coverPdfUrl} target="_blank" rel="noreferrer">
                      {t("savedCl")}
                    </a>
                  </Button>
                ) : null}
                <Button
                  data-testid="job-remove-button"
                  variant="outline"
                  size="sm"
                  disabled={deletingIds.has(selectedJob.id)}
                  onClick={() => onDelete(selectedJob)}
                  className={`w-full justify-center rounded-xl border-destructive/30 bg-destructive/10 text-sm font-medium text-destructive shadow-sm transition-all duration-200 hover:border-destructive/50 hover:bg-destructive/20 hover:text-destructive active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none sm:ml-auto sm:w-auto ${actionHeight} px-4`}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {t("remove")}
                </Button>
              </div>
            </div>
            {tailorSource ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {tailorSource.cv ? (
                  <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5">
                    {t("tailorSourceCv", {
                      source: tailorSourceLabel(tailorSource.cv),
                    })}
                  </span>
                ) : null}
                {tailorSource.cover ? (
                  <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5">
                    {t("tailorSourceCover", {
                      source: tailorSourceLabel(tailorSource.cover),
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="relative text-sm text-muted-foreground">{t("selectJobToPreview")}</div>
        )}
      </div>
      <ScrollArea
        ref={scrollRootRef}
        type="scroll"
        data-testid="jobs-details-scroll"
        data-loading={showLoadingOverlay ? "true" : "false"}
        className={`jobs-scroll-area max-h-full flex-1 min-h-0 transition-opacity duration-200 ease-out ${listOpacityClass}`}
      >
        <div className="p-4">
          {selectedJob ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              {/* Premium section header — icon + label + hairline rule. */}
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-100 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                  {t("jobDescriptionTitle")}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden />
              </div>
              <JobRequirementsPanel
                analysis={experienceAnalysis}
                description={selectedDescription}
                matrix={selectedFitMatrix}
              />
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
                <div className="p-1">
                  {selectedDescription ? (
                    <JobDescriptionMarkdown
                      description={selectedDescription}
                      experienceAnalysis={experienceAnalysis}
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
              <p className="max-w-[18rem] text-sm text-muted-foreground">{t("selectJobHint")}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
