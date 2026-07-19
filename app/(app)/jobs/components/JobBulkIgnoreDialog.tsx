"use client";

import { ArchiveX, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface JobBulkIgnoreDialogProps {
  open: boolean;
  count: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Reversible low-fit sweep confirmation.
 *
 * Kept separate from permanent-delete confirmation: "ignore" moves jobs to
 * Rejected and preserves their score, while delete destroys the record.
 */
export function JobBulkIgnoreDialog({
  open,
  count,
  pending,
  onOpenChange,
  onConfirm,
}: JobBulkIgnoreDialogProps) {
  const t = useTranslations("jobs.fitScan");
  const tc = useTranslations("common");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent className="max-w-md overflow-hidden rounded-3xl border-border/70 p-0 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.5)]">
        <div className="border-b border-border/60 bg-gradient-to-br from-brand-emerald-50/80 via-background to-background px-6 py-5 dark:from-brand-emerald-500/10">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-emerald-100 text-brand-emerald-700 ring-1 ring-brand-emerald-200 dark:bg-brand-emerald-500/15 dark:text-brand-emerald-300 dark:ring-brand-emerald-500/25">
            <ArchiveX className="h-5 w-5" aria-hidden />
          </div>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-xl tracking-tight">
              {t("ignoreDialogTitle", { count })}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              {t("ignoreDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter className="gap-2 px-6 pb-6 sm:space-x-0">
          <AlertDialogCancel
            disabled={pending}
            className="h-11 rounded-xl px-5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tc("cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="h-11 rounded-xl bg-brand-emerald-600 px-5 font-semibold text-white shadow-sm hover:bg-brand-emerald-700"
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" aria-hidden />
                {t("ignoreWorking")}
              </>
            ) : (
              t("ignoreAction")
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
