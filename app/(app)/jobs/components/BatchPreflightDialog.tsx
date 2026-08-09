"use client";

import Link from "next/link";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BatchPreflightView = {
  eligibleCount: number;
  maxJobs: number;
  profileReady: boolean;
  ready: number;
  incomplete: number;
  alreadyGenerated: number;
  eligibleTotal: number;
  totalNew: number;
  capped: boolean;
};

export function BatchPreflightDialog({
  open,
  onOpenChange,
  preflight,
  runnerStatus,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preflight: BatchPreflightView;
  runnerStatus: "online" | "offline" | "unknown" | "unavailable";
  submitting: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("jobs.batchPreflight");

  if (!preflight.profileReady) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="batch-preflight-dialog">
          <DialogHeader>
            <DialogTitle>{t("profileTitle")}</DialogTitle>
            <DialogDescription>{t("profileDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button asChild size="touch" className="bg-brand-emerald-700 text-white hover:bg-brand-emerald-800">
              <Link href="/resume">{t("openResume")}</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const runnerMessage =
    runnerStatus === "online"
      ? t("runnerReady")
      : runnerStatus === "offline"
        ? t("runnerOffline")
        : t("runnerChecking");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="batch-preflight-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("title", { count: preflight.eligibleCount })}
          </DialogTitle>
          <DialogDescription>{t("globalScope")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/35 p-3">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-text" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">
                {t("documents", { count: preflight.eligibleCount })}
              </p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                {t("documentsDescription")}
              </p>
            </div>
          </div>
          <dl
            className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-3"
            aria-label={t("breakdownLabel")}
          >
            <Breakdown value={preflight.ready} label={t("ready")} />
            <Breakdown value={preflight.incomplete} label={t("incomplete")} />
            <Breakdown value={preflight.alreadyGenerated} label={t("alreadyGenerated")} />
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("breakdownDescription", {
              ready: preflight.ready,
              incomplete: preflight.incomplete,
              alreadyGenerated: preflight.alreadyGenerated,
            })}
          </p>
          <p className="leading-relaxed text-muted-foreground">{runnerMessage}</p>
          {preflight.capped ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {t("capped", {
                maxJobs: preflight.maxJobs,
                eligibleTotal: preflight.eligibleTotal,
              })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="touch"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="touch"
            disabled={submitting}
            aria-busy={submitting}
            onClick={onConfirm}
            className="bg-brand-emerald-700 text-white hover:bg-brand-emerald-800"
          >
            {submitting ? (
              <Loader2 className="motion-safe:animate-spin" aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            {submitting
              ? t("starting")
              : t("confirm", { count: preflight.eligibleCount })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Breakdown({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 min-[440px]:block min-[440px]:text-center">
      <dt className="text-xs leading-4 text-muted-foreground min-[440px]:text-[11px]">{label}</dt>
      <dd className="font-bold tabular-nums text-foreground min-[440px]:mt-0.5">{value}</dd>
    </div>
  );
}
