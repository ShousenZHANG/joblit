"use client";

import { Download, ArrowRight, CheckCircle2, Package } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("jobs.external");
  if (isFresh) {
    return (
      <div className="rounded-xl border border-brand-emerald-200 bg-brand-emerald-50/50 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-emerald-100">
            <CheckCircle2 className="h-5 w-5 text-brand-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-brand-emerald-900">
              {t("freshTitle")}
            </h3>
            <p className="mt-1 text-sm text-brand-emerald-text">
              {t("freshDescription")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={onContinue}
                className="h-10 rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 active:translate-y-[1px]"
              >
                {t("continueToCopy")}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={onDownload}
                disabled={isLoading}
                className="text-xs text-brand-emerald-600 underline-offset-4 hover:underline disabled:opacity-50"
              >
                {isLoading ? t("downloading") : t("redownloadZip")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Package className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {t("importTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("importDescription")}
          </p>

          <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                1
              </span>
              {t("importStep1")}
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                2
              </span>
              {t("importStep2")}
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                3
              </span>
              {t("importStep3")}
            </li>
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={isLoading || isPromptLoading || !hasPromptMeta}
              onClick={onDownload}
              className="h-10 rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              <Download className="mr-1.5 h-4 w-4" />
              {isLoading
                ? t("downloading")
                : isPromptLoading
                  ? t("preparing")
                  : t("downloadZip")}
            </Button>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground/85 hover:underline"
          >
            {t("alreadyLoaded")}
          </button>
        </div>
      </div>
    </div>
  );
}
