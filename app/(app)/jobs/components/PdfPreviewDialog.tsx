"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfPreview: { url: string; filename: string; label: string } | null;
}

export function PdfPreviewDialog({ open, onOpenChange, pdfPreview }: PdfPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[92vh] w-[98vw] max-w-[min(98vw,1280px)] overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{pdfPreview?.label ?? "PDF preview"}</DialogTitle>
          <DialogDescription>Preview the generated PDF.</DialogDescription>
        </DialogHeader>
        <div className="flex h-full flex-col">
          <div className="flex h-11 items-center justify-between border-b border-slate-900/10 bg-white/90 px-3">
            <div className="text-xs font-medium text-muted-foreground">
              {pdfPreview?.label ?? "PDF preview"}
            </div>
            <div className="flex items-center gap-2">
              {pdfPreview ? (
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-xl border-border bg-white px-3 text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted/40 active:translate-y-[1px]"
                >
                  <a href={pdfPreview.url} download={pdfPreview.filename}>
                    <Download className="mr-1.5 h-4 w-4" />
                    Download PDF
                  </a>
                </Button>
              ) : null}
              <DialogClose asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-xl border-border bg-white px-3 text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted/40 active:translate-y-[1px]"
                >
                  Close
                </Button>
              </DialogClose>
            </div>
          </div>
          <div className="flex-1 bg-white">
            {pdfPreview ? (
              <iframe
                title={pdfPreview.label}
                src={pdfPreview.url}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No preview available.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
