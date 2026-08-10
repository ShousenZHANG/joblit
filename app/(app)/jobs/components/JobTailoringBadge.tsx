"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { JobItem } from "../types";

/**
 * The row-level answer to "did I already ask for this one, and is it done?"
 *
 * Before this, the only evidence a batch existed was a banner tied to the
 * session that queued it. Reload the page, or open it on a phone, and every
 * row looked exactly as it had before the button was pressed — so the rational
 * move was to queue it again, which is how a user ends up with three batches
 * competing over the same Job.
 *
 * `ready` is derived from the Application the row already carries rather than
 * from a task status: the artifact is the completion. A task row that claims
 * success without one would be the more suspect of the two.
 */
type TailoringDisplayState = "queued" | "running" | "stalled" | "failed" | "ready";

/**
 * Written out rather than interpolated. The i18n contract test scans source
 * for each key's final segment, so a computed `t(\`tailoring${state}\`)` would
 * read as five orphaned keys and fail the build.
 */
const LABEL_KEY: Record<TailoringDisplayState, string> = {
  queued: "tailoringQueued",
  running: "tailoringRunning",
  stalled: "tailoringStalled",
  failed: "tailoringFailed",
  ready: "tailoringReady",
};

const BADGE_CLASS: Record<TailoringDisplayState, string> = {
  // Waiting on a Runner: informative, not alarming.
  queued:
    "border border-border/70 bg-muted/60 text-foreground/70 dark:bg-muted/30",
  running:
    "border border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300",
  // Amber, not red: the work is recoverable, and reap-on-read will requeue it.
  stalled:
    "border border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300",
  failed:
    "border border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300",
  ready:
    "border border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-text dark:border-brand-emerald-400/30 dark:bg-brand-emerald-500/10",
};

export function jobTailoringDisplayState(
  job: Pick<JobItem, "tailoringState" | "applicationId">,
): TailoringDisplayState | null {
  const state = job.tailoringState ?? "idle";
  // Live work outranks a finished artifact: a regenerate in flight is the more
  // recent truth, and hiding it behind "ready" would make the second run look
  // like it never started.
  if (state !== "idle") return state;
  return job.applicationId ? "ready" : null;
}

export function JobTailoringBadge({
  job,
}: {
  job: Pick<JobItem, "tailoringState" | "applicationId">;
}) {
  const t = useTranslations("jobs");
  const state = jobTailoringDisplayState(job);
  if (!state) return null;

  return (
    <Badge className={BADGE_CLASS[state]}>
      {state === "running" ? (
        <span
          aria-hidden
          className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
        />
      ) : null}
      {t(LABEL_KEY[state])}
    </Badge>
  );
}
