import React from "react";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Square } from "lucide-react";
import type { JobItem, JobStatus } from "../types";

function formatInsertedTime(iso: string) {
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return "unknown";
  const diffMs = Date.now() - createdAt.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day ago`;
}

function formatLocalDateTime(iso: string, timeZone: string | null) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

const STATUS_CLASS: Record<JobStatus, string> = {
  // High-contrast semantic badges tuned for both themes:
  // NEW      — emerald (fresh opportunity, aligns with brand accent)
  // APPLIED  — sky blue (action taken, in-progress)
  // REJECTED — rose (terminal, visually distinct from neutral grey)
  NEW:
    "border border-emerald-300/60 bg-emerald-100 text-emerald-800 " +
    "dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-300",
  APPLIED:
    "border border-sky-300/60 bg-sky-100 text-sky-800 " +
    "dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-300",
  REJECTED:
    "border border-rose-300/60 bg-rose-100 text-rose-800 " +
    "dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-300",
};

function JobListItemInner({
  job,
  isActive,
  onSelect,
  timeZone,
  batchMode,
  batchSelected,
  onBatchToggle,
}: {
  job: JobItem;
  isActive: boolean;
  onSelect: () => void;
  timeZone: string | null;
  batchMode?: boolean;
  batchSelected?: boolean;
  onBatchToggle?: (id: string) => void;
}) {
  const listLabel = `${job.title} at ${job.company || "Unknown"}`;

  return (
    <div role="listitem" aria-current={isActive ? "true" : undefined} aria-label={listLabel} className="w-full">
      <div
        className={`joblit-list-item flex w-full items-start gap-0 rounded-2xl border border-l-4 border-border/60 bg-background/80 text-left backdrop-blur-sm transition-all duration-200 ease-out hover:-translate-y-[1px] ${
          batchSelected
            ? "border-l-brand-emerald-500 bg-brand-emerald-50/70 shadow-sm ring-1 ring-brand-emerald-200/70"
            : isActive
              ? "border-l-brand-emerald-500 bg-brand-emerald-50/50 shadow-sm"
              : "border-l-transparent hover:border-border hover:bg-background"
        }`}
      >
        {batchMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onBatchToggle?.(job.id);
            }}
            className="flex shrink-0 items-center justify-center py-3 pl-3 pr-1"
            aria-label={batchSelected ? `Deselect ${job.title}` : `Select ${job.title}`}
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
          className="min-w-0 flex-1 cursor-pointer px-3 py-3 text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Badge className={STATUS_CLASS[job.status]}>{job.status}</Badge>
            </div>
            <span
              className="text-xs text-muted-foreground"
              title={formatLocalDateTime(job.createdAt, timeZone)}
            >
              {formatInsertedTime(job.createdAt)}
            </span>
          </div>
          <div className="mt-2 text-sm font-semibold">{job.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {job.company ?? "-"} - {job.location ?? "-"}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {job.jobType ?? "Unknown"} - {job.jobLevel ?? "Unknown"}
          </div>
        </button>
      </div>
    </div>
  );
}

export const JobListItem = React.memo(JobListItemInner);
