"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useResumeContext } from "./ResumeContext";
import { cn } from "@/lib/utils";

/**
 * The quiet counterpart to autosave.
 *
 * Convention across every product that saves silently (and GitLab's Pajamas
 * guidance verbatim): a small, low-contrast status near the document title
 * that walks Saving… → Saved. It states what happened; it never asks for
 * anything. The one exception is failure, where it becomes actionable, because
 * a silent save that silently failed is the worst outcome of all.
 */
export function SaveIndicator({ className }: { className?: string }) {
  const { autosaveStatus, autosaveRetry, hasAnyContent, t } = useResumeContext();

  if (!hasAnyContent) return null;

  if (autosaveStatus === "error") {
    return (
      <div
        className={cn("flex items-center gap-1.5 text-xs font-medium text-destructive", className)}
        data-testid="resume-save-indicator"
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        <span role="status">{t("autosaveFailed")}</span>
        <button
          type="button"
          onClick={autosaveRetry}
          className="rounded-full px-2 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  const saving = autosaveStatus === "saving";
  // "idle" means nothing has been persisted this session yet — say nothing
  // rather than claim a save that never happened.
  if (!saving && autosaveStatus !== "saved") return null;

  return (
    <div
      className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}
      data-testid="resume-save-indicator"
    >
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <Check className="h-3.5 w-3.5 text-brand-emerald-600" aria-hidden />
      )}
      <span role="status" aria-live="polite">
        {saving ? t("saving") : t("autosaveSaved")}
      </span>
    </div>
  );
}
