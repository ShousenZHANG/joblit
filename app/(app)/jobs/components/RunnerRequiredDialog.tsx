"use client";

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

/**
 * The gate that stops a generation click from disappearing into silence.
 *
 * AI generation runs on the user's own machine. If nothing is listening, the
 * batch would queue and sit there — which used to look identical to a batch
 * that was working. Checking presence before queueing turns that into a
 * sentence the user can act on, and names the zero-install alternative rather
 * than pretending the Runner is mandatory.
 */
export function RunnerRequiredDialog({
  open,
  onOpenChange,
  onOpenSetup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSetup: () => void;
}) {
  const t = useTranslations("jobs.runnerRequired");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="runner-required-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("later")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false);
              onOpenSetup();
            }}
          >
            {t("setUp")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
