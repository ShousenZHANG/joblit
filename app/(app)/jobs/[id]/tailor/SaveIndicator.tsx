"use client";

import { useEffect, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { SaveStatus } from "./useTailorDraft";

interface SaveIndicatorProps {
  status: SaveStatus;
  /** Re-trigger a save when the previous attempt failed. */
  onRetry?: () => void;
}

/**
 * Header status pill: 'Saved Xs ago' / 'Saving...' / 'Unsaved changes'
 * / 'Save failed'. Updates every 5s while idle so the relative text
 * stays fresh.
 */
export function SaveIndicator({ status, onRetry }: SaveIndicatorProps) {
  const t = useTranslations("tailor");
  const format = useFormatter();
  const now = useNow();
  // Re-render every 5s while saved so the relative label stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status.kind !== "saved") return;
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [status]);

  if (status.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        {t("save.saving")}
      </span>
    );
  }
  if (status.kind === "dirty") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-amber-500"
        />
        {t("save.unsaved")}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full text-xs font-medium text-destructive transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
        title={status.message}
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        {t("save.failedRetry")}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-emerald-text">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      {t("save.savedAt", { time: format.relativeTime(new Date(status.at), now) })}
    </span>
  );
}
