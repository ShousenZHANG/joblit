"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Download, ExternalLink, Minus, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrbitSpinner } from "@/components/ui/orbit-spinner";
import {
  COARSE_POINTER_MIN_HEIGHT,
  COARSE_POINTER_TARGET,
} from "@/components/ui/touchTarget";
import { cn } from "@/lib/utils";
import { buildPdfFilename } from "@/lib/shared/pdfFilename";
import { useResumeContext } from "./ResumeContext";

// react-pdf + pdfjs worker is the single heaviest client dependency
// (hundreds of KB). Lazy-load it so it's only fetched when the preview
// panel actually mounts, keeping it out of the initial route bundle.
// ssr:false — pdfjs needs the DOM/canvas, can't render on the server.
const ResumePdfPreview = dynamic(
  () => import("./ResumePdfPreview").then((m) => m.ResumePdfPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <OrbitSpinner />
      </div>
    ),
  },
);

interface PreviewPanelProps {
  className?: string;
}

export function PreviewPanel({ className }: PreviewPanelProps) {
  const {
    pdfUrl,
    previewStatus,
    previewError,
    schedulePreview,
    hasUnpreviewedChanges,
    basics,
    t,
  } = useResumeContext();

  const downloadFilename = buildPdfFilename(
    basics.fullName,
    basics.title,
    "cv",
    t("unnamedResumeFilename"),
  );

  const currentPdfUrl = pdfUrl ?? null;

  // Zoom is a view setting, not draft state: it never reaches the payload and
  // is deliberately not persisted. 1 means "fit the pane", which is the only
  // level most people ever need; the steps above it exist for checking whether
  // a line actually fits, which is the reason to lean in on a resume.
  const [zoom, setZoom] = useState(1);
  const zoomIn = () => setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));

  return (
    <div
      data-slot="resume-desktop-preview"
      className={cn("flex flex-col bg-muted/40 dark:bg-muted/20", className)}
    >
      {/* Header — design spec ".preview-head" 44px tall */}
      <div className="relative flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3">
        {/* A LaTeX compile takes seconds, and the preview deliberately keeps
            the previous page painted while it runs — which leaves nothing
            moving to say work is happening. This indeterminate bar rides the
            bottom edge of the header for exactly that: it costs no layout, it
            never covers the document, and it disappears the moment the new
            page swaps in. */}
        {previewStatus === "loading" ? (
          <span
            aria-hidden
            data-testid="preview-progress"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
          >
            <span className="block h-full w-1/3 animate-[resume-preview-progress_1.1s_ease-in-out_infinite] rounded-full bg-emerald-500 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
          </span>
        ) : null}
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t("pdfPreview")}
        </span>
        {/* Says the quiet part out loud: the draft has moved on from this
            picture. Without it a commit-based refresh looks like a stale
            preview rather than a deliberate one. */}
        {hasUnpreviewedChanges && previewStatus !== "loading" ? (
          <span
            data-testid="preview-pending-badge"
            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {t("previewPending")}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {/* Zoom. Only meaningful once there is a page to inspect, so it
              stays out of the way until one exists. */}
          {currentPdfUrl ? (
            <div
              className="mr-1 flex items-center gap-0.5"
              data-testid="preview-zoom"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 rounded-md", COARSE_POINTER_TARGET)}
                aria-label={t("previewZoomOut")}
                disabled={zoom <= 0.5}
                onClick={zoomOut}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label={t("previewZoomReset")}
                data-testid="preview-zoom-level"
                className="min-w-[3.25rem] rounded-md px-1 py-0.5 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 rounded-md", COARSE_POINTER_TARGET)}
                aria-label={t("previewZoomIn")}
                disabled={zoom >= 2}
                onClick={zoomIn}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}

          {/* Refresh */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 rounded-md transition-transform active:scale-90 disabled:cursor-not-allowed disabled:opacity-100",
              COARSE_POINTER_TARGET,
            )}
            aria-label={t("refreshPreview")}
            aria-busy={previewStatus === "loading"}
            disabled={previewStatus === "loading"}
            onClick={() => schedulePreview(0, false, { force: true })}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                previewStatus === "loading" && "animate-spin text-emerald-600",
              )}
            />
          </Button>

          {/* Open in new tab */}
          {currentPdfUrl ? (
            <a
              href={currentPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("openPreviewNewTab")}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                COARSE_POINTER_TARGET,
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}

          <span aria-hidden className="mx-1 h-4 w-px bg-border" />

          {/* Download primary */}
          {currentPdfUrl ? (
            <a
              href={currentPdfUrl}
              download={downloadFilename}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97]",
                COARSE_POINTER_MIN_HEIGHT,
              )}
            >
              <Download className="h-3.5 w-3.5" />
              <span>PDF</span>
            </a>
          ) : (
            <span className="inline-flex h-7 cursor-not-allowed items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs font-medium text-muted-foreground/70">
              <Download className="h-3.5 w-3.5" />
              <span>PDF</span>
            </span>
          )}
        </div>
      </div>

      {/* Preview area — soft gradient backdrop with the rendered PDF
          centred and lifted on a subtle drop shadow, mirroring the
          A4 paper feel of Linear / Resend / Notion preview panes. */}
      <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-muted/40 via-muted/25 to-muted/15 dark:from-muted/15 dark:via-muted/10 dark:to-muted/5">
        {/* A4 skeleton loading state */}
        {previewStatus === "idle" && !pdfUrl && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-[420px]">
              <div className="aspect-[1/1.414] w-full rounded-sm border border-border bg-card shadow-[0_18px_40px_-22px_rgba(15,23,42,0.18)] flex items-center justify-center">
                <p className="text-xs text-muted-foreground px-4 text-center">
                  {t("preview")}
                </p>
              </div>
            </div>
          </div>
        )}

        {previewStatus === "loading" && !pdfUrl && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-[420px]">
              <div className="aspect-[1/1.414] w-full animate-pulse rounded-sm bg-muted shadow-[0_18px_40px_-22px_rgba(15,23,42,0.18)]" />
            </div>
          </div>
        )}

        {pdfUrl && (
          <div className="absolute inset-0 overflow-auto px-3 py-4 sm:px-5 sm:py-5">
            {/*
              Canvas-based PDF render via react-pdf / pdfjs. Replaces the
              old <iframe> embed which always painted a dark gutter below
              the rendered page (Chrome / Edge PDF viewer behaviour we
              cannot override across origins). The canvas approach owns
              every pixel, so there is zero leftover background regardless
              of page count or paper size.
            */}
            <ResumePdfPreview pdfUrl={pdfUrl} maxWidth={760} zoom={zoom} />
          </div>
        )}

        {/*
          No "Generating preview…" overlay when a stale preview is on
          screen — ResumePdfPreview keeps the previous canvas painted
          while the new document loads in the background, so flashing
          the overlay on every refresh would actually hide a perfectly
          good preview behind a translucent card. The toolbar Refresh
          button already shows a spinning icon for in-flight feedback.
        */}

        {previewStatus === "error" && (
          <div
            role="alert"
            className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
          >
            <span>{previewError ?? t("previewFailed")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={COARSE_POINTER_MIN_HEIGHT}
              onClick={() => schedulePreview(0, false, { force: true })}
            >
              {t("retryPreview")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
