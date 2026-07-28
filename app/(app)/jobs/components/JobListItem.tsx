"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { COARSE_POINTER_MIN_HEIGHT } from "@/components/ui/touchTarget";
import { Ban, CheckSquare, Square } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { type JobItem } from "../types";
import { jobStatusPresentation } from "../utils/jobStatusPresentation";

// AI role-fit badge tone by score band (deterministic verdict thresholds).
function fitBadgeClass(score: number): string {
  if (score >= 75) {
    return (
      "border border-emerald-300/60 bg-emerald-100 text-emerald-800 " +
      "dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-300"
    );
  }
  if (score >= 60) {
    return (
      "border border-sky-300/60 bg-sky-100 text-sky-800 " +
      "dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-300"
    );
  }
  if (score >= 45) {
    return (
      "border border-amber-300/60 bg-amber-100 text-amber-800 " +
      "dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-300"
    );
  }
  return "border border-border bg-muted text-muted-foreground";
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    jobicy: "Jobicy",
    jobspy: "LinkedIn",
    nowcoder: "Nowcoder",
    remoteok: "Remote OK",
    remotive: "Remotive",
  };
  return labels[source] ?? source;
}

function JobListItemInner({
  job,
  isActive,
  onSelect,
  timeZone,
  batchMode,
  batchSelected,
  onBatchToggle,
  setSize,
  positionInSet,
}: {
  job: JobItem;
  isActive: boolean;
  onSelect: () => void;
  timeZone: string | null;
  batchMode?: boolean;
  batchSelected?: boolean;
  onBatchToggle?: (id: string) => void;
  setSize?: number;
  positionInSet?: number;
}) {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const now = useNow();

  const companyName = job.company || t("unknownCompany");
  const listLabel = t("listItemAria", { title: job.title, company: companyName });
  const fitEligibilityConclusion =
    job.fitEligibility === "PASS"
      ? t("fitEligibilityPass")
      : job.fitEligibility === "RISK"
        ? t("fitEligibilityRisk")
        : job.fitEligibility === "BLOCK"
          ? t("fitEligibilityBlock")
          : null;

  const createdAt = new Date(job.createdAt);
  const createdAtValid = !Number.isNaN(createdAt.getTime());
  const relativeCreatedAt = createdAtValid ? format.relativeTime(createdAt, now) : t("unknownTime");
  const exactCreatedAt = createdAtValid
    ? format.dateTime(createdAt, {
        dateStyle: "medium",
        timeStyle: "short",
        ...(timeZone ? { timeZone } : {}),
      })
    : t("unknownTime");

  return (
    <div
      role="listitem"
      aria-label={listLabel}
      aria-setsize={setSize}
      aria-posinset={positionInSet}
      className="w-full"
    >
      <div
        className={`joblit-list-item flex w-full items-start gap-0 rounded-2xl border border-l-4 border-border/60 bg-background/80 text-left backdrop-blur-sm transition-all duration-200 ease-out hover:-translate-y-[1px] ${
          batchSelected
            ? "border-l-brand-emerald-500 bg-brand-emerald-50/70 shadow-sm ring-1 ring-brand-emerald-200/70"
            : isActive
              ? "border-l-brand-emerald-500 bg-brand-emerald-50/50 shadow-sm"
              : // Signal lock: hovering a row lights its left edge emerald. The
              // 4px left border is always present, so this costs zero layout.
              "border-l-transparent hover:border-border hover:border-l-brand-emerald-500/70 hover:bg-background"
        }`}
      >
        {batchMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onBatchToggle?.(job.id);
            }}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center py-3 pl-3 pr-1"
            aria-label={batchSelected ? t("deselectJob", { title: job.title }) : t("selectJob", { title: job.title })}
          >
            {batchSelected ? (
              <CheckSquare className="h-[18px] w-[18px] text-brand-emerald-600" />
            ) : (
              <Square className="h-[18px] w-[18px] text-muted-foreground/60 transition-colors hover:text-foreground/70" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={batchMode ? () => onBatchToggle?.(job.id) : onSelect}
          data-job-id={job.id}
          data-perf="cv-auto"
          tabIndex={isActive ? 0 : -1}
          aria-current={isActive ? "true" : undefined}
          className={`min-w-0 flex-1 cursor-pointer px-3 py-3 text-left ${COARSE_POINTER_MIN_HEIGHT}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Badge className={jobStatusPresentation(job.status).badgeClass}>
                {t(jobStatusPresentation(job.status).labelKey)}
              </Badge>
              {typeof job.fitScore === "number" ? (
                <Badge
                  className={fitBadgeClass(job.fitScore)}
                  title={job.fitVerdict ?? undefined}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center gap-1"
                  >
                    {job.fitEligibility === "BLOCK" ? (
                      <Ban aria-hidden="true" className="h-3 w-3" />
                    ) : null}
                    {job.fitScore}
                  </span>
                  <span className="sr-only">
                    {fitEligibilityConclusion
                      ? `${fitEligibilityConclusion} `
                      : null}
                    {job.fitVerdict
                      ? t("fitScoreDetails", {
                          score: job.fitScore,
                          verdict: job.fitVerdict,
                        })
                      : t("fitScoreDetailsUnavailable", {
                          score: job.fitScore,
                        })}
                  </span>
                </Badge>
              ) : null}
              {typeof job.postingRisk === "number" && job.postingRisk >= 25 ? (
                <Badge
                  className={
                    job.postingRisk >= 50
                      ? "border border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300"
                      : "border border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300"
                  }
                  title={(job.postingRiskFlags ?? []).join(", ")}
                >
                  {t("postingRisk", { score: job.postingRisk })}
                </Badge>
              ) : null}
              {job.livenessStatus === "EXPIRED" ? (
                <Badge
                  className="border border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300"
                  title={job.livenessReason ?? undefined}
                >
                  {t("livenessExpired")}
                </Badge>
              ) : job.livenessStatus === "UNCERTAIN" ? (
                <Badge
                  className="border border-border bg-muted/70 text-muted-foreground"
                  title={job.livenessReason ?? undefined}
                >
                  {t("livenessUncertain")}
                </Badge>
              ) : null}
              {job.possibleDuplicate ? (
                <Badge className="border border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
                  {t("possibleDuplicate")}
                </Badge>
              ) : null}
            </div>
            <span
              className="text-xs text-muted-foreground"
              title={exactCreatedAt}
            >
              {relativeCreatedAt}
            </span>
          </div>
          <div className="mt-2 text-sm font-semibold">{job.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {job.company ?? "-"} - {job.location ?? "-"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{job.jobType ?? t("unknownJobType")}</span>
            {job.jobLevel ? <span>· {job.jobLevel}</span> : null}
            {job.workArrangement ? (
              <span className="rounded-full bg-brand-emerald-50 px-1.5 py-0.5 font-medium text-brand-emerald-text ring-1 ring-brand-emerald-100">
                {job.workArrangement}
              </span>
            ) : null}
            {job.source ? (
              <span className="rounded-full border border-border/70 bg-muted/45 px-1.5 py-0.5 font-medium text-foreground/65">
                {sourceLabel(job.source)}
              </span>
            ) : null}
            {job.salary ? (
              <span className="font-medium text-foreground/75">{job.salary}</span>
            ) : null}
          </div>
        </button>
      </div>
    </div>
  );
}

export const JobListItem = React.memo(JobListItemInner);
