"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  DollarSign,
  ExternalLink,
  FileText,
  MapPin,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react";
import { useMarket } from "@/hooks/useMarket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { JobItem, JobStatus, CvSource, CoverSource } from "../types";
import { parseExperienceGate } from "../utils/experienceParser";

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

const statusClass: Record<JobStatus, string> = {
  NEW: "bg-brand-emerald-100 text-brand-emerald-700 ring-1 ring-brand-emerald-200",
  APPLIED:
    "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)] ring-1 ring-[theme(colors.tier-good-ring)]",
  REJECTED: "bg-muted text-muted-foreground ring-1 ring-border",
};

interface JobDetailPanelProps {
  selectedJob: JobItem | null;
  selectedDescription: string;
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
  onGenerateResume: (job: JobItem) => void;
  onGenerateCover: (job: JobItem) => void;
}

/** Small icon + label pill for the header meta row. Renders nothing when the
 *  value is empty so the row stays tight. */
function MetaChip({ icon: Icon, value }: { icon: React.ElementType; value?: string | null }) {
  const text = value?.trim();
  if (!text) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-xs font-medium text-foreground/75 shadow-sm">
      <Icon className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600 dark:text-brand-emerald-400" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function JobDetailPanel({
  selectedJob,
  selectedDescription,
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
  onGenerateResume,
  onGenerateCover,
}: JobDetailPanelProps) {
  const t = useTranslations("jobs");
  // CN market ships a single Chinese résumé end-to-end — no AI CV tailoring or
  // cover-letter generation — so those actions are hidden there.
  const isCN = useMarket() === "CN";
  const statusLabel: Record<JobStatus, string> = {
    NEW: t("statusNew"),
    APPLIED: t("statusApplied"),
    REJECTED: t("statusRejected"),
  };
  const isAppliedSelected = selectedJob?.status === "APPLIED";
  const listOpacityClass = showLoadingOverlay ? "opacity-70" : "opacity-100";
  const actionHeight = isAppliedSelected ? "h-9" : "h-10";

  const experienceSignals = useMemo(
    () => parseExperienceGate(selectedDescription),
    [selectedDescription],
  );

  return (
    <div
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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  {selectedJob.title}
                </h2>
                <Badge className={cn("rounded-full px-2.5 text-[10px] font-bold uppercase tracking-wider", statusClass[selectedJob.status])}>
                  {selectedJob.status}
                </Badge>
              </div>
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
                  icon={CalendarDays}
                  value={
                    selectedJob.listingDate
                      ? `Posted ${new Date(selectedJob.listingDate).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}`
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
                  value={selectedJob.status}
                  onValueChange={(v) => onUpdateStatus(selectedJob.id, v as JobStatus)}
                  disabled={updatingIds.has(selectedJob.id)}
                >
                  <SelectTrigger
                    className={`rounded-xl border-border bg-background shadow-sm ${
                      isAppliedSelected ? "h-9 w-full px-3 text-sm sm:w-[118px]" : "h-10 w-full sm:w-[132px]"
                    }`}
                  >
                    <span className="truncate">{statusLabel[selectedJob.status]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW">{t("statusNew")}</SelectItem>
                    <SelectItem value="APPLIED">{t("statusApplied")}</SelectItem>
                    <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  asChild
                  size="sm"
                  className={`w-full justify-center rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_rgba(5,150,105,0.8)] transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 hover:shadow-[0_14px_28px_-14px_rgba(5,150,105,0.9)] active:translate-y-[1px] sm:w-auto ${actionHeight} px-4`}
                >
                  <a href={selectedJob.jobUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" />
                    {t("openJob")}
                  </a>
                </Button>
                {!isCN ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={externalPromptLoading}
                      onClick={() => onGenerateResume(selectedJob)}
                      className={`w-full justify-center rounded-xl border-brand-emerald-200 bg-brand-emerald-50/60 text-sm font-semibold text-brand-emerald-800 shadow-sm transition-all duration-200 hover:border-brand-emerald-300 hover:bg-brand-emerald-100/70 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300 sm:w-auto ${actionHeight} px-4 ${highlightGenerate ? guideHighlightClass : ""}`}
                      data-guide-highlight={highlightGenerate ? "true" : "false"}
                      data-guide-anchor="generate_first_pdf"
                    >
                      <Sparkles className="mr-1 h-4 w-4" />
                      {t("generateCv")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={externalPromptLoading}
                      onClick={() => onGenerateCover(selectedJob)}
                      className={`w-full justify-center rounded-xl border-brand-emerald-200 bg-brand-emerald-50/60 text-sm font-semibold text-brand-emerald-800 shadow-sm transition-all duration-200 hover:border-brand-emerald-300 hover:bg-brand-emerald-100/70 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300 sm:w-auto ${actionHeight} px-4 ${highlightGenerate ? guideHighlightClass : ""}`}
                      data-guide-highlight={highlightGenerate ? "true" : "false"}
                    >
                      <Sparkles className="mr-1 h-4 w-4" />
                      {t("generateCl")}
                    </Button>
                  </>
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
                    CV: {tailorSource.cv === "ai" ? "AI" : tailorSource.cv === "manual_import" ? "Manual" : "Base"}
                  </span>
                ) : null}
                {tailorSource.cover ? (
                  <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5">
                    Cover: {tailorSource.cover === "ai" ? "AI" : tailorSource.cover === "manual_import" ? "Manual" : "Fallback"}
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
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-emerald-50 text-brand-emerald-700 ring-1 ring-brand-emerald-100 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                  Job Description
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden />
              </div>
              {experienceSignals.length ? (
                <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-muted/50 to-muted/20 p-3.5 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.5)]">
                  <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                    Experience gate
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {experienceSignals.map((signal) => (
                      <span
                        key={signal.key}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                          signal.isRequired
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-[theme(colors.tier-fair-ring)] bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]"
                        }`}
                        title={signal.evidence}
                      >
                        {signal.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {detailError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {detailError}
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
                    <JobDescriptionMarkdown description={selectedDescription} />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No description available for this job yet.
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
}
