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
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-emerald-900">
              AI instructions are up to date
            </h3>
            <p className="mt-1 text-sm text-emerald-700/80">
              Your skill pack matches the current resume snapshot. No need to
              re-import.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={onContinue}
                className="h-10 rounded-xl border border-emerald-500 bg-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-emerald-600 hover:bg-emerald-600 active:translate-y-[1px]"
              >
                Continue to Copy Prompt
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={onDownload}
                disabled={isLoading}
                className="text-xs text-emerald-600 underline-offset-4 hover:underline disabled:opacity-50"
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
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          <Package className="h-5 w-5 text-slate-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">
            Import AI Instructions
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Download a ZIP file that teaches Claude, ChatGPT, or Gemini how to
            tailor your resume perfectly.
          </p>

          <ol className="mt-3 space-y-1.5 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                1
              </span>
              Click &quot;Download ZIP&quot; below
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                2
              </span>
              Open Claude/ChatGPT &rarr; Upload ZIP files as Project Knowledge
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
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
              className="h-10 rounded-xl border border-emerald-500 bg-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-emerald-600 hover:bg-emerald-600 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
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
            className="mt-3 text-xs text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
          >
            Already imported? Skip to next step &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
