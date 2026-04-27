"use client";

import { Check, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResumeContext } from "./ResumeContext";

export function ResumeActionBar() {
  const { saving, handleSave, setPreviewOpen, hasAnyContent, schedulePreview, isTaskHighlighted, t } =
    useResumeContext();

  const guideHighlightClass =
    "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";

  return (
    <div
      className="sticky bottom-0 z-10 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-sm"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
      data-guide-anchor="resume_setup"
      data-testid="resume-action-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: save status */}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          {saving ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
          )}
          <span className="truncate">{saving ? t("saving") : t("toastSaved")}</span>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {/* Mobile only: preview toggle */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-[7rem] whitespace-nowrap md:hidden"
            disabled={!hasAnyContent}
            onClick={() => {
              setPreviewOpen(true);
              schedulePreview(0);
            }}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            {t("preview")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className={`edu-cta edu-cta--press min-w-[8rem] whitespace-nowrap ${
              isTaskHighlighted("resume_setup") ? guideHighlightClass : ""
            }`}
            data-guide-highlight={isTaskHighlighted("resume_setup") ? "true" : "false"}
          >
            {saving ? t("saving") : t("saveSelectedResume")}
          </Button>
        </div>
      </div>
    </div>
  );
}
