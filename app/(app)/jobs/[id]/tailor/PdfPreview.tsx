"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileText, RefreshCcw } from "lucide-react";
import { ResumePdfPreview } from "@/components/resume/ResumePdfPreview";
import { cn } from "@/lib/utils";

interface PdfPreviewProps {
  /** Current rendered PDF URL. May be null on first load. */
  pdfUrl: string | null;
  /** Title used for the iframe a11y title. */
  jobTitle: string;
  /** Triggered when the user clicks Refresh or after 30s idle. */
  onRefresh: () => Promise<void> | void;
  /** Render-in-progress flag. */
  isRefreshing: boolean;
  /**
   * Timestamp (ms) of the last successful render. Used for the
   * "Last refresh: Xs ago" hint.
   */
  lastRefreshedAt: number | null;
  /** Whether the preview has a debounced render queued. */
  isPending?: boolean;
  /** Enable legacy idle refresh. Disabled in the Jobs review dialog. */
  autoRefresh?: boolean;
}

const IDLE_REFRESH_MS = 30_000;

export function PdfPreview({
  pdfUrl,
  jobTitle,
  onRefresh,
  isRefreshing,
  lastRefreshedAt,
  isPending = false,
  autoRefresh = true,
}: PdfPreviewProps) {
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastLabel, setLastLabel] = useState<string | null>(null);
  const previewSrc = useMemo(
    () => (pdfUrl ? withPreviewCacheBust(pdfUrl, lastRefreshedAt) : null),
    [lastRefreshedAt, pdfUrl],
  );

  // Tick "Last refresh: Xs ago" every 5s. setState only fires inside
  // timer callbacks (subscription handlers), never synchronously in
  // the effect body, to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!lastRefreshedAt) return;
    function tick() {
      setLastLabel(formatRelative(Date.now() - lastRefreshedAt!));
    }
    const initial = setTimeout(tick, 0);
    const id = setInterval(tick, 5_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [lastRefreshedAt]);

  // 30s-idle auto-refresh: any keypress / pointer-move resets the timer;
  // when the timer expires, kick a refresh once. Only re-arms when
  // the user resumes activity.
  useEffect(() => {
    if (!autoRefresh) return;
    function arm() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        void onRefresh();
      }, IDLE_REFRESH_MS);
    }
    function onActivity() {
      arm();
    }
    arm();
    window.addEventListener("keydown", onActivity);
    window.addEventListener("pointermove", onActivity);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointermove", onActivity);
    };
  }, [autoRefresh, onRefresh]);

  return (
    <aside
      aria-label={`PDF preview for ${jobTitle}`}
      className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[1.35rem] border border-border bg-muted/40 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.32)]"
    >
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          PDF preview
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isPending ? (
            <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 sm:inline-flex">
              Updating soon
            </span>
          ) : lastLabel ? (
            <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">
              Last: {lastLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
            aria-label="Refresh preview"
            aria-busy={isRefreshing}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-transform hover:bg-muted hover:text-foreground active:scale-90",
              "disabled:pointer-events-none disabled:opacity-70",
            )}
          >
            <RefreshCcw
              className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              aria-hidden
            />
          </button>
          {previewSrc ? (
            <a
              href={previewSrc}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open preview in new tab"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          {previewSrc ? (
            <a
              href={previewSrc}
              download
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              <span>PDF</span>
            </a>
          ) : (
            <span className="inline-flex h-7 cursor-not-allowed items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs font-medium text-muted-foreground/70">
              <Download className="h-3.5 w-3.5" aria-hidden />
              <span>PDF</span>
            </span>
          )}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-muted/40 via-muted/25 to-muted/15">
        {previewSrc ? (
          <div className="absolute inset-0 overflow-auto px-3 py-4 sm:px-4">
            <ResumePdfPreview pdfUrl={previewSrc} maxWidth={760} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-[340px]">
              <div className="flex aspect-[1/1.414] w-full items-center justify-center rounded-sm border border-border bg-card shadow-[0_18px_40px_-22px_rgba(15,23,42,0.18)]">
                <div className="flex max-w-[220px] flex-col items-center gap-2 px-4 text-center text-xs text-muted-foreground">
                  <FileText className="h-6 w-6 text-muted-foreground/50" aria-hidden />
                  <span>No preview yet - click Refresh to render.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function formatRelative(diffMs: number): string {
  if (diffMs < 5_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1_000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

function withPreviewCacheBust(url: string, refreshedAt: number | null): string {
  if (!refreshedAt) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}preview=${refreshedAt}`;
}
