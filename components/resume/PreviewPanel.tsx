"use client";

import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useResumeContext } from "./ResumeContext";
import { ResumePdfPreview } from "./ResumePdfPreview";

interface PreviewPanelProps {
  className?: string;
}

export function PreviewPanel({ className }: PreviewPanelProps) {
  const { pdfUrl, previewStatus, previewError, schedulePreview, basics, locale, t } =
    useResumeContext();

  const downloadFilename = (() => {
    const fallback = locale === "zh-CN" ? "未命名简历" : "Unnamed_Resume";
    if (!basics.fullName && !basics.title) return `${fallback}.pdf`;
    const safeName = (basics.fullName || "").replace(/\s+/g, "_");
    const safeTitle = (basics.title || "").replace(/\s+/g, "_");
    const connector = safeName && safeTitle ? "_" : "";
    return `${safeName}${connector}${safeTitle}.pdf`;
  })();

  const isReady = pdfUrl && previewStatus === "ready";

  return (
    <div className={cn("flex flex-col bg-muted/40 dark:bg-muted/20", className)}>
      {/* Header — design spec ".preview-head" 44px tall */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t("pdfPreview")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Refresh */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md transition-transform active:scale-90 disabled:cursor-not-allowed disabled:opacity-100"
            aria-label="Refresh preview"
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
          {isReady ? (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}

          <span aria-hidden className="mx-1 h-4 w-px bg-border" />

          {/* Download primary */}
          {isReady ? (
            <a
              href={pdfUrl}
              download={downloadFilename}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97]"
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
            <ResumePdfPreview pdfUrl={pdfUrl} maxWidth={760} />
          </div>
        )}

        {previewStatus === "loading" && pdfUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs text-muted-foreground">
            {t("previewGenerating") ?? "Generating preview…"}
          </div>
        )}

        {previewStatus === "error" && (
          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <span>{previewError ?? t("previewFailed")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => schedulePreview(0, false, { force: true })}
            >
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
