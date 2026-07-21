"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Download, ExternalLink, FileText, RefreshCcw } from "lucide-react";
import { OrbitSpinner } from "@/components/ui/orbit-spinner";
import { cn } from "@/lib/utils";

// react-pdf + pdfjs (~120KB gzip) is the heaviest client dep. Lazy-load it so
// it's only fetched when this preview actually mounts, matching the boundary
// already used in components/resume/PreviewPanel.tsx. ssr:false — pdfjs needs
// DOM/canvas.
const ResumePdfPreview = dynamic(
  () => import("@/components/resume/ResumePdfPreview").then((m) => m.ResumePdfPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <OrbitSpinner />
      </div>
    ),
  },
);

interface PdfPreviewProps {
  /** Current rendered PDF URL. May be null on first load. */
  pdfUrl: string | null;
  /** Title used for the iframe a11y title. */
  jobTitle: string;
  /**
   * Canonical `{Full Name} {Title}_{CV|CL}.pdf` name for the Download button.
   * Without it the browser names the file from the URL, which is a Blob
   * storage path or an opaque `blob:` UUID — neither is a filename a user
   * wants on disk.
   */
  downloadFilename: string;
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
  downloadFilename,
  onRefresh,
  isRefreshing,
  lastRefreshedAt,
  isPending = false,
  autoRefresh = true,
}: PdfPreviewProps) {
  const t = useTranslations("tailor");
  const format = useFormatter();
  const now = useNow();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped every 5s so the locale-aware relative label re-renders fresh.
  const [, setTick] = useState(0);
  const previewSrc = useMemo(
    () => (pdfUrl ? withPreviewCacheBust(pdfUrl, lastRefreshedAt) : null),
    [lastRefreshedAt, pdfUrl],
  );
  const lastLabel = lastRefreshedAt
    ? format.relativeTime(new Date(lastRefreshedAt), now)
    : null;

  // Re-render "Last: Xs ago" every 5s. setState only fires inside the
  // timer callback (subscription handler), never synchronously in the
  // effect body, to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!lastRefreshedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
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
      aria-label={t("preview.ariaLabel", { title: jobTitle })}
      className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[1.35rem] border border-border bg-muted/40 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.32)]"
    >
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t("preview.title")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isPending ? (
            <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 sm:inline-flex">
              {t("preview.updatingSoon")}
            </span>
          ) : lastLabel ? (
            <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">
              {t("preview.last", { time: lastLabel })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
            aria-label={t("preview.refreshAria")}
            aria-busy={isRefreshing}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-transform hover:bg-muted hover:text-foreground active:scale-90",
              "disabled:pointer-events-none disabled:opacity-70",
            )}
          >
            <RefreshCcw
              className={cn(
                "h-3.5 w-3.5",
                isRefreshing && "animate-spin motion-reduce:animate-none",
              )}
              aria-hidden
            />
          </button>
          {previewSrc ? (
            <a
              href={previewSrc}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("preview.openNewTabAria")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          {previewSrc ? (
            <a
              href={previewSrc}
              download={downloadFilename}
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
                  <span>{t("preview.empty")}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export function withPreviewCacheBust(
  url: string,
  refreshedAt: number | null,
): string {
  if (!refreshedAt) return url;
  // Object URLs are immutable already. Appending a query creates a different
  // blob URL that browsers cannot resolve.
  if (url.startsWith("blob:")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}preview=${refreshedAt}`;
}
