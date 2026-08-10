"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { JobItem } from "../types";

/**
 * Ask for this Job, from this Job.
 *
 * Generation used to live only in the list toolbar, as "queue every NEW job in
 * one press". That is the right tool for a triage sweep and the wrong one for
 * the far more common case: reading one description and deciding you want it.
 * The toolbar version also refused outright while any run was draining, so
 * wanting one Job meant waiting on a hundred unrelated ones.
 *
 * The button reports the server's own state rather than a local "did I click
 * it" flag. A flag would reset on reload and lie after a Runner died; this
 * cannot say "queued" unless a task really is queued.
 */
export function JobGenerateButton({
  job,
  pending,
  onGenerate,
  className,
}: {
  job: Pick<JobItem, "id" | "tailoringState" | "applicationId">;
  /** This specific Job's request is in flight. */
  pending: boolean;
  onGenerate: (jobId: string) => void;
  className?: string;
}) {
  const t = useTranslations("jobs");
  const state = job.tailoringState ?? "idle";

  // A finished Application is shown by the Saved CV/CL buttons beside this one.
  // Offering "Generate" there too would invite a second run whose only effect
  // is to overwrite work the user already accepted.
  if (state === "idle" && job.applicationId) return null;

  const busy = pending || state === "queued" || state === "running";
  const label = pending
    ? t("generateQueueing")
    : state === "queued"
      ? t("tailoringQueued")
      : state === "running"
        ? t("tailoringRunning")
        : state === "stalled"
          ? t("tailoringStalled")
          : state === "failed"
            ? t("generateRetry")
            : t("generateThisJob");

  return (
    <Button
      size="sm"
      variant={state === "failed" ? "outline" : "default"}
      // `stalled` is not disabled-but-hopeless: reap-on-read requeues it, so
      // the honest affordance is a label that says so and a control that does
      // not invite a second, duplicate request.
      disabled={busy || state === "stalled"}
      aria-busy={busy}
      data-testid="job-generate-button"
      title={state === "stalled" ? t("generateStalledHint") : undefined}
      onClick={() => onGenerate(job.id)}
      className={className}
    >
      {busy ? (
        <Loader2 className="mr-1 h-4 w-4 motion-safe:animate-spin" aria-hidden />
      ) : (
        <Sparkles className="mr-1 h-4 w-4" aria-hidden />
      )}
      {label}
    </Button>
  );
}
