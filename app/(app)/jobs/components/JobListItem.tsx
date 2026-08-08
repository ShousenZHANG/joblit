"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { COARSE_POINTER_MIN_HEIGHT } from "@/components/ui/touchTarget";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { type JobItem } from "../types";
import { jobStatusPresentation } from "../utils/jobStatusPresentation";

/**
 * Source feeds ship literal placeholder strings ("not applicable",
 * "unknown") in jobType/jobLevel. Rendering them verbatim turned the meta
 * row into noise; a placeholder is the absence of a value, so treat it as
 * one.
 */
function meaningful(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^(not applicable|unknown|n\/a|none)$/i.test(trimmed) ? null : trimmed;
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
  onSelectJob,
  timeZone,
  setSize,
  positionInSet,
}: {
  job: JobItem;
  isActive: boolean;
  /** Stable reference — an inline `() => select(id)` closure would defeat
   *  React.memo and re-render every row on each parent keystroke. */
  onSelectJob: (id: string) => void;
  timeZone: string | null;
  setSize?: number;
  positionInSet?: number;
}) {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const now = useNow();

  const companyName = job.company || t("unknownCompany");
  const listLabel = t("listItemAria", { title: job.title, company: companyName });

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
          isActive
            ? "border-l-brand-emerald-500 bg-brand-emerald-50/50 shadow-sm"
            : // Signal lock: hovering a row lights its left edge emerald. The
              // 4px left border is always present, so this costs zero layout.
              "border-l-transparent hover:border-border hover:border-l-brand-emerald-500/70 hover:bg-background"
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectJob(job.id)}
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
            {meaningful(job.jobType) ? <span>{meaningful(job.jobType)}</span> : null}
            {meaningful(job.jobLevel) ? <span>· {meaningful(job.jobLevel)}</span> : null}
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
