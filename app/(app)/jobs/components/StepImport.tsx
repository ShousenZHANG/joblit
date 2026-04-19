"use client";

import { Download, ArrowRight, CheckCircle2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

type StepImportProps = {
  isFresh: boolean;
  isLoading: boolean;
  isPromptLoading: boolean;
  hasPromptMeta: boolean;
  onDownload: () => void;
  onSkip: () => void;
  onContinue: () => void;
};

export function StepImport({
  isFresh,
  isLoading,
  isPromptLoading,
  hasPromptMeta,
  onDownload,
  onSkip,
  onContinue,
}: StepImportProps) {
  if (isFresh) {
    return (
      <div className="rounded-xl border border-brand-emerald-200 bg-brand-emerald-50/50 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-emerald-100">
            <CheckCircle2 className="h-5 w-5 text-brand-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-brand-emerald-900">
              AI instructions are up to date
            </h3>
            <p className="mt-1 text-sm text-brand-emerald-700/80">
              Your skill pack matches the current resume snapshot. No need to
              re-import.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={onContinue}
                className="h-10 rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 active:translate-y-[1px]"
              >
                Continue to Copy Prompt
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={onDownload}
                disabled={isLoading}
                className="text-xs text-brand-emerald-600 underline-offset-4 hover:underline disabled:opacity-50"
              >
                {isLoading ? "Downloading..." : "Re-download ZIP"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Package className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            Import AI Instructions
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Download a ZIP file that teaches Claude, ChatGPT, or Gemini how to
            tailor your resume perfectly.
          </p>

          <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                1
              </span>
              Click &quot;Download ZIP&quot; below
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                2
              </span>
              Open Claude/ChatGPT &rarr; Upload ZIP files as Project Knowledge
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                3
              </span>
              Come back here for Step 2
            </li>
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={isLoading || isPromptLoading || !hasPromptMeta}
              onClick={onDownload}
              className="h-10 rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-slate-200 disabled:text-muted-foreground disabled:shadow-none"
            >
              <Download className="mr-1.5 h-4 w-4" />
              {isLoading
                ? "Downloading..."
                : isPromptLoading
                  ? "Preparing..."
                  : "Download ZIP"}
            </Button>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground/85 hover:underline"
          >
            Already imported? Skip to next step &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
