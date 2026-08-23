"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, Cloud, Loader2 } from "lucide-react";
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
 *
 * Two changes over the first cut, both aimed at the same complaint — that the
 * indicator was there and still went unnoticed:
 *
 *  - It no longer disappears. Rendering nothing until the first save of the
 *    session meant the one moment a new user most wants reassurance was the
 *    one moment the row was empty. Before anything has been persisted it now
 *    says so plainly instead of vanishing.
 *  - "Saved" carries a relative time. A label that never changes stops being
 *    read; "Saved · 2m ago" is re-read because it moves, and it answers the
 *    actual question, which is not "did it save" but "is what I see on disk".
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Re-render cadence for the relative label. Coarse on purpose: the label's
 *  own resolution is a minute, so ticking faster would repaint for nothing. */
const TICK_MS = 30_000;

export function SaveIndicator({ className }: { className?: string }) {
  const {
    autosaveStatus,
    autosaveLastSavedAt,
    autosaveRetry,
    hasAnyContent,
    t,
  } = useResumeContext();

  // Drives the relative label forward while the page sits idle. Only mounted
  // work is a setState on a timer; no listeners, no layout reads.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (autosaveLastSavedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [autosaveLastSavedAt]);

  if (!hasAnyContent) return null;

  if (autosaveStatus === "error") {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium text-destructive",
          className,
        )}
        data-testid="resume-save-indicator"
        data-status="error"
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

  /** "Saved · just now" until a minute has passed, then minutes, then hours.
   *  Past a day the exact age stops being useful, so it degrades to the bare
   *  word rather than inventing a date format. */
  function savedLabel(): string {
    if (autosaveLastSavedAt === null) return t("autosaveSaved");
    const elapsed = Math.max(0, now - autosaveLastSavedAt);
    if (elapsed < MINUTE_MS) return t("autosaveSavedJustNow");
    if (elapsed < HOUR_MS) {
      return t("autosaveSavedMinutes", {
        minutes: Math.floor(elapsed / MINUTE_MS),
      });
    }
    const hours = Math.floor(elapsed / HOUR_MS);
    if (hours < 24) return t("autosaveSavedHours", { hours });
    return t("autosaveSaved");
  }

  const idle = !saving && autosaveStatus !== "saved";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      data-testid="resume-save-indicator"
      data-status={saving ? "saving" : idle ? "idle" : "saved"}
    >
      {saving ? (
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      ) : idle ? (
        <Cloud className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Check className="h-3.5 w-3.5 text-brand-emerald-600" aria-hidden />
      )}
      <span role="status" aria-live="polite">
        {saving
          ? t("saving")
          : idle
            ? t("autosaveIdle")
            : savedLabel()}
      </span>
    </div>
  );
}
