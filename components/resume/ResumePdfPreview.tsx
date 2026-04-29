"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Page, pdfjs } from "react-pdf";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Bundle the pdfjs web worker via the Next.js asset pipeline so it lives
// next to the JS chunk that imports it. Avoids a runtime CDN fetch and
// keeps offline / strict-CSP environments working.
if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

interface ResumePdfPreviewProps {
  /** Blob URL produced by useResumePreview. */
  pdfUrl: string;
  /** Maximum page width in CSS pixels. */
  maxWidth?: number;
  className?: string;
}

/**
 * ResumePdfPreview — canvas-based, double-buffered PDF preview.
 *
 * Why bypass <Document>:
 *   The high-level <Document> component reloads its internal pdfjs
 *   instance every time the `file` prop changes, which clears the
 *   <Page> canvases for a few hundred ms — the user sees the preview
 *   flash to white on every refresh. By driving pdfjs directly we can
 *   keep the previous PDFDocumentProxy painted on screen while the
 *   next one is fetched in the background, then atomically swap the
 *   reference once the new document is fully loaded. No flicker.
 *
 * Other niceties:
 *   - ResizeObserver tracks container width so canvases re-render at
 *     whatever zoom the panel is currently sized to (capped by
 *     maxWidth).
 *   - Text + annotation layers are disabled — purely visual preview,
 *     ~30% cheaper per-page render and no text-selection styling
 *     leaking into the canvas.
 *   - First load shows a centered spinner; subsequent loads keep the
 *     old pages visible.
 */
export function ResumePdfPreview({ pdfUrl, maxWidth = 760, className }: ResumePdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(maxWidth);
  // The currently displayed document. Only updates after a new
  // pdfjs.getDocument() resolves successfully, which gives us a clean
  // atomic swap instead of a teardown-then-rebuild sequence.
  const [displayedDoc, setDisplayedDoc] = useState<PDFDocumentProxy | null>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // Track the available width so each Page renders at the right zoom.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const sync = () => {
      const next = Math.min(node.clientWidth, maxWidth);
      if (next > 0) setContainerWidth(next);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [maxWidth]);

  // Drive pdfjs directly so we can keep the previous document on screen
  // while the next one is fetched. The cancellation flag prevents a
  // stale resolution from clobbering a newer load that started after.
  useEffect(() => {
    if (!pdfUrl) return;

    let cancelled = false;
    const loadingTask = pdfjs.getDocument({ url: pdfUrl });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          // A newer load took over before this one finished — release
          // the abandoned document so pdfjs can free its memory.
          void doc.destroy();
          return;
        }
        setDisplayedDoc((prev) => {
          // Tear down the previous document only after the new one is
          // ready to be displayed.
          if (prev && prev !== doc) {
            void prev.destroy();
          }
          return doc;
        });
        setIsFirstLoad(false);
      })
      .catch(() => {
        // Network / parse errors fall through to the idle state — the
        // surrounding PreviewPanel already surfaces a retry banner.
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [pdfUrl]);

  // Drop the latest document on unmount so pdfjs frees its workers.
  useEffect(() => {
    return () => {
      setDisplayedDoc((prev) => {
        if (prev) void prev.destroy();
        return null;
      });
    };
  }, []);

  const numPages = displayedDoc?.numPages ?? 0;

  return (
    <div
      ref={containerRef}
      className={cn("flex w-full flex-col items-center gap-3", className)}
    >
      {numPages === 0 && isFirstLoad ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        </div>
      ) : null}

      {displayedDoc
        ? Array.from({ length: numPages }, (_, index) => (
            <div
              key={`${pdfUrl}-page-${index + 1}`}
              className="overflow-hidden rounded-sm bg-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.20),0_4px_12px_-4px_rgba(15,23,42,0.08)] ring-1 ring-border/60"
            >
              <Page
                pdf={displayedDoc}
                pageNumber={index + 1}
                width={containerWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="!block"
              />
            </div>
          ))
        : null}
    </div>
  );
}
