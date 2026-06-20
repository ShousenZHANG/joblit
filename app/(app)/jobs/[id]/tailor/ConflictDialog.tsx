"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConflictDialogProps {
  onReload: () => void;
  onOverwrite: () => void;
}

/**
 * Multi-tab conflict dialog: shown when an autosave receives 409
 * STALE_WRITE because another tab has updated the same Application.
 *
 * Reload  -> discard local in-progress edits, refetch from server.
 * Overwrite -> kept as Reload for safety in v1; Phase 4 may wire a
 * /draft?force=true endpoint.
 *
 * Built on the AlertDialog primitive (Radix) so focus trap, Esc handling,
 * and focus restore come for free — the previous bare <div role="dialog">
 * had none of those.
 */
export function ConflictDialog({ onReload, onOverwrite }: ConflictDialogProps) {
  const t = useTranslations("tailor");
  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-md rounded-2xl border-border/60 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.5)]">
        <AlertDialogHeader>
          <div className="flex items-start gap-3 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <AlertDialogTitle className="text-base">
                {t("conflictTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 leading-relaxed">
                {t("conflictBody")}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onOverwrite}
            className="rounded-full text-muted-foreground"
          >
            {t("conflictKeepEdits")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onReload}
            className="rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {t("conflictReload")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
