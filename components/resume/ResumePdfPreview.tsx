"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
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
 * ResumePdfPreview — canvas-based PDF preview replacing the previous
 * <iframe> approach.
 *
 * Why canvas instead of iframe:
 *   1. Iframe-embedded browser PDF viewers always reserve a dark canvas
 *      backdrop below the rendered page that we cannot reach into via
 *      cross-origin script. The visible "black gutter" persists even
 *      with `toolbar=0&navpanes=0`.
 *   2. react-pdf renders each page directly onto a <canvas> at a width
 *      we control, so the rendered output matches the page exactly with
 *      zero leftover background.
 *   3. We get the page count from pdfjs metadata for free, so multi-
 *      page resumes scroll through stacked pages naturally.
 *
 * The component is responsive: a ResizeObserver tracks the container
 * width and tells react-pdf to re-render at the new resolution, so the
 * preview always fills the available pane without hard-coded breakpoints.
 */
export function ResumePdfPreview({ pdfUrl, maxWidth = 760, className }: ResumePdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(maxWidth);
  const [numPages, setNumPages] = useState<number>(0);

  // Track the available width so react-pdf renders at the right zoom.
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

  // Memoise file source so react-pdf does not re-fetch on every render.
  // It accepts a string or { url } object — we pass an object so the
  // identity is stable while pdfUrl is unchanged.
  const fileSource = useMemo(() => ({ url: pdfUrl }), [pdfUrl]);

  return (
    <div
      ref={containerRef}
      className={cn("flex w-full flex-col items-center gap-3", className)}
    >
      <Document
        file={fileSource}
        loading={
          <div className="flex h-full w-full items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </div>
        }
        error={
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            Could not render preview.
          </div>
        }
        onLoadSuccess={({ numPages: total }) => setNumPages(total)}
        // Disable the default white background fill — our wrapper already
        // ships the paper-white surface, drop-shadow, and border ring.
        className="flex w-full flex-col items-center gap-3"
      >
        {Array.from({ length: numPages }, (_, index) => (
          <div
            key={`page_${index + 1}`}
            className="overflow-hidden rounded-sm bg-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.20),0_4px_12px_-4px_rgba(15,23,42,0.08)] ring-1 ring-border/60"
          >
            <Page
              pageNumber={index + 1}
              width={containerWidth}
              // Disable text + annotation layers — purely visual preview,
              // skips ~30% of the per-page render cost and avoids text
              // selection styling leaking into the canvas.
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="!block"
            />
          </div>
        ))}
      </Document>
    </div>
  );
}
