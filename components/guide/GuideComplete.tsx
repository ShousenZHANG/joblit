"use client";

import { useTranslations } from "next-intl";
import { Check, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ONBOARDING_TASKS } from "@/lib/onboarding";

interface GuideCompleteProps {
  onDismiss: () => void;
}

/**
 * Celebration view shown once every onboarding step is done. A spring-popped
 * gradient medallion + breathing halo marks the achievement, and a recap list
 * reflects everything the user set up — turning the end of onboarding into a
 * rewarding moment rather than an empty "all done" line.
 */
export function GuideComplete({ onDismiss }: GuideCompleteProps) {
  const t = useTranslations("guide");
  return (
    <div className="flex flex-1 flex-col items-center px-5 pb-6 pt-8 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-emerald-500/15 guide-beacon motion-reduce:animate-none"
        />
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_18px_36px_-18px_rgba(5,150,105,0.85)] guide-checkpop motion-reduce:animate-none">
          <PartyPopper className="h-8 w-8" aria-hidden />
        </span>
      </div>

      <h2 className="mt-5 text-lg font-bold text-foreground">{t("allDone")}</h2>
      <p className="mx-auto mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
        {t("allDoneDesc")}
      </p>

      <div className="mt-5 w-full rounded-2xl border border-border/60 bg-muted/30 p-3 text-left">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("recapTitle")}
        </p>
        <ul className="space-y-1.5">
          {ONBOARDING_TASKS.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-[12.5px] text-foreground">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="h-2.5 w-2.5" aria-hidden />
              </span>
              {t(`task_${task.id}_title`)}
            </li>
          ))}
        </ul>
      </div>

      <Button
        type="button"
        onClick={onDismiss}
        className="mt-5 h-10 w-full rounded-xl bg-emerald-600 text-sm font-semibold hover:bg-emerald-700"
      >
        {t("dismissPanel")}
      </Button>
    </div>
  );
}
