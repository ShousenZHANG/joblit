"use client";

import Link from "next/link";
import {
  Check,
  CircleStop,
  Cpu,
  Loader2,
  RefreshCw,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  LocalAiAvailability,
  LocalAiRunState,
} from "../hooks/useLocalAiRun";

type LocalAiJob = {
  id: string;
  title: string;
  company: string | null;
  target: "resume" | "cover";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availability: LocalAiAvailability;
  runState: LocalAiRunState;
  job: LocalAiJob | null;
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
  onCheckAgain: () => void;
  onUseManual: () => void;
};

const activeStages = ["starting", "queued", "running", "stopping", "importing"];

export function LocalAiGenerateDialog({
  open,
  onOpenChange,
  availability,
  runState,
  job,
  onStart,
  onStop,
  onRetry,
  onCheckAgain,
  onUseManual,
}: Props) {
  const t = useTranslations("jobs.localAi");
  const isImporting = runState.status === "importing";
  const isActive = activeStages.includes(runState.status);
  const isReady = availability === "ready";
  const isRunLost = runState.status === "failed" && runState.error.code === "RUN_LOST";
  const statusLabel = getStatusLabel(t, availability, runState);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isImporting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[min(94vw,560px)] max-w-[560px] overflow-hidden rounded-3xl border-border/70 p-0 shadow-[0_32px_90px_-44px_rgba(15,23,42,0.75)]">
        <div className="relative overflow-hidden border-b border-border/60 bg-[linear-gradient(135deg,rgba(5,150,105,0.13),transparent_58%)] px-6 pb-5 pt-6">
          <div aria-hidden className="absolute right-5 top-5 h-20 w-20 rounded-full border border-brand-emerald-300/40 bg-brand-emerald-100/30 blur-[1px]" />
          <DialogHeader className="relative gap-2 text-left">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-emerald-700 dark:text-brand-emerald-300">
              <Cpu className="h-4 w-4" aria-hidden />
              {t("eyebrow")}
            </div>
            <DialogTitle className="text-xl tracking-tight">
              {job?.target === "cover" ? t("titleCover") : t("titleResume")}
            </DialogTitle>
            <DialogDescription className="max-w-[44ch] text-sm leading-6">
              {job ? t("forJob", { title: job.title, company: job.company ?? t("companyFallback") }) : t("recovering")}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div
            aria-live="polite"
            className="relative overflow-hidden rounded-2xl border border-border/70 bg-muted/30 px-4 py-4"
          >
            <div className="flex items-center gap-3">
              <span className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                isReady
                  ? "border-brand-emerald-300 bg-brand-emerald-100 text-brand-emerald-700"
                  : "border-border bg-background text-muted-foreground",
              )}>
                {runState.status === "succeeded" ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : isActive || availability === "detecting" ? (
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{statusLabel}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {runState.status === "running" && runState.progressChars
                    ? t("progressChars", { count: runState.progressChars })
                    : isReady
                      ? t("localOnly")
                      : t("setupHint")}
                </p>
              </div>
            </div>

            {isActive ? (
              <div className="mt-4 grid grid-cols-4 gap-1" aria-hidden>
                {["queued", "running", "importing", "succeeded"].map((stage, index) => {
                  const current = stageIndex(runState.status);
                  return (
                    <span
                      key={stage}
                      className={cn(
                        "h-1.5 rounded-full transition-colors motion-reduce:transition-none",
                        index <= current ? "bg-brand-emerald-500" : "bg-border",
                      )}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>

          {runState.status === "failed" ? (
            <div role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-medium text-destructive">
                {errorLabel(t, runState.error.code)}
              </p>
              {runState.error.retryable ? (
                <Button variant="outline" size="sm" className="mt-3 rounded-xl" onClick={onRetry}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                  {isRunLost ? t("startNewRun") : t("retry")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {!isReady && runState.status === "idle" ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="h-11 flex-1 rounded-xl bg-brand-emerald-600 text-white hover:bg-brand-emerald-700">
                <Link href="/extension">{t("openSetup")}</Link>
              </Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={onCheckAgain}>
                {t("checkAgain")}
              </Button>
            </div>
          ) : null}

          {isReady && (runState.status === "idle" || runState.status === "cancelled" || runState.status === "succeeded") ? (
            <Button
              className="h-12 w-full rounded-xl bg-brand-emerald-600 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(5,150,105,0.95)] hover:bg-brand-emerald-700"
              disabled={!job}
              onClick={onStart}
            >
              <WandSparkles className="mr-2 h-4 w-4" aria-hidden />
              {t("generate")}
            </Button>
          ) : null}

          {isActive && runState.status !== "importing" && runState.status !== "starting" ? (
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={onStop}>
              <CircleStop className="mr-2 h-4 w-4" aria-hidden />
              {t("cancel")}
            </Button>
          ) : null}

          <div className="flex items-center justify-between border-t border-border/60 pt-4">
            <button
              type="button"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
              disabled={isImporting || !job}
              onClick={onUseManual}
            >
              {t("useManual")}
            </button>
            <span className="text-[11px] text-muted-foreground">{t("beta")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function stageIndex(status: LocalAiRunState["status"]): number {
  if (status === "starting" || status === "queued" || status === "stopping") return 0;
  if (status === "running") return 1;
  if (status === "importing") return 2;
  return 3;
}

type Translate = ReturnType<typeof useTranslations>;

function getStatusLabel(
  t: Translate,
  availability: LocalAiAvailability,
  runState: LocalAiRunState,
) {
  if (runState.status !== "idle") return t(`stage.${runState.status}`);
  return t(`availability.${availability}`);
}

function errorLabel(t: Translate, code: string) {
  const known = new Set([
    "EXTENSION_STORAGE_UNAVAILABLE",
    "FORBIDDEN_CALLER",
    "INVALID_REQUEST",
    "RATE_LIMITED",
    "HERMES_NOT_CONFIGURED",
    "RUN_START_UNKNOWN",
    "RUN_LOST",
    "HERMES_UNREACHABLE",
    "HERMES_AUTH_FAILED",
    "HERMES_ORIGIN_FORBIDDEN",
    "HERMES_INCOMPATIBLE",
    "HERMES_RATE_LIMITED",
    "HERMES_RESPONSE_TOO_LARGE",
    "HERMES_PROTOCOL_ERROR",
    "UNEXPECTED_APPROVAL_REQUIRED",
    "AI_OUTPUT_INVALID",
    "HERMES_RUN_FAILED",
    "AI_TIMEOUT",
    "INVALID_AI_RESULT",
    "IMPORT_FAILED",
    "LOCAL_AI_NOT_READY",
    "RUN_START_FAILED",
    "RUN_STATUS_FAILED",
    "RUN_STOP_FAILED",
    "BRIDGE_UNAVAILABLE",
    "BRIDGE_INVALID_REQUEST",
    "BRIDGE_ABORTED",
    "BRIDGE_PROTOCOL_ERROR",
    "BRIDGE_TIMEOUT",
  ]);
  return t(`errors.${known.has(code) ? code : "UNKNOWN"}`);
}
