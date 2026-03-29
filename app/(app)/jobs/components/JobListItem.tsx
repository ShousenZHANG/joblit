import React from "react";
import { Badge } from "@/components/ui/badge";
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
  NEW: "bg-emerald-100 text-emerald-700",
  APPLIED: "bg-sky-100 text-sky-700",
  REJECTED: "bg-slate-200 text-slate-600",
};

function JobListItemInner({
  job,
  isActive,
  onSelect,
  timeZone,
}: {
  job: JobItem;
  isActive: boolean;
  onSelect: () => void;
  timeZone: string | null;
}) {
  const listLabel = `${job.title} at ${job.company || "Unknown"}`;

  return (
    <div role="listitem" aria-current={isActive ? "true" : undefined} aria-label={listLabel} className="w-full">
      <button
        type="button"
        onClick={onSelect}
        data-job-id={job.id}
        data-perf="cv-auto"
        className={`jobflow-list-item w-full rounded-2xl border border-l-4 border-slate-900/10 bg-white/80 px-3 py-3 text-left transition-all duration-200 ease-out hover:-translate-y-[1px] ${
          isActive
            ? "border-l-emerald-500 bg-emerald-50/60 shadow-sm"
            : "border-l-transparent hover:border-slate-900/20 hover:bg-white"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <Badge className={STATUS_CLASS[job.status]}>{job.status}</Badge>
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
  );
}

export const JobListItem = React.memo(JobListItemInner);
