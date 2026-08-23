"use client";

import { useTranslations } from "next-intl";
import { ChevronsDownUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Collapse all entries" for a repeatable section.
 *
 * Entries can now be open at the same time — comparing two roles used to mean
 * closing one to read the other — which makes a way back to the overview
 * necessary. It renders only when something is actually open, so a tidy
 * section carries no control at all.
 */
export function CollapseAllButton({
  open,
  onCollapseAll,
  className,
}: {
  /** How many entries are currently expanded. */
  open: number;
  onCollapseAll: () => void;
  className?: string;
}) {
  const t = useTranslations("resumeForm");
  if (open === 0) return null;

  return (
    <button
      type="button"
      onClick={onCollapseAll}
      data-testid="resume-collapse-all"
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground",
        "transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600",
        className,
      )}
    >
      <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
      {t("collapseAll")}
    </button>
  );
}
