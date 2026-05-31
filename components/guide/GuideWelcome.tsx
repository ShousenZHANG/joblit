"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Search, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JoblitMark } from "@/components/brand/JoblitMark";

const FEATURES = [
  { key: "welcomeFeature1", icon: Search },
  { key: "welcomeFeature2", icon: Sparkles },
  { key: "welcomeFeature3", icon: Send },
] as const;

interface GuideWelcomeProps {
  onStart: () => void;
  onSkip: () => void;
}

/**
 * First-run welcome view shown inside the Quick Start panel the first time a
 * brand-new user lands. Sets the product value proposition before dropping
 * them into the checklist — the warm, branded "moment" that Linear / Vercel /
 * Superhuman open with. Only auto-shown once per session; explicit reopens go
 * straight to the checklist.
 */
export function GuideWelcome({ onStart, onSkip }: GuideWelcomeProps) {
  const t = useTranslations("guide");
  return (
    <div className="flex flex-1 flex-col px-5 pb-6 pt-7 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_18px_36px_-18px_rgba(5,150,105,0.85)] guide-checkpop motion-reduce:animate-none">
        <JoblitMark size={34} color="#ffffff" ariaLabel={null} />
      </div>
      <h2 className="mt-4 text-lg font-bold tracking-tight text-foreground">
        {t("welcomeTitle")}
      </h2>
      <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
        {t("welcomeDesc")}
      </p>

      <ul className="mt-5 space-y-2.5 text-left">
        {FEATURES.map(({ key, icon: Icon }, i) => (
          <li
            key={key}
            className="guide-rise flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-[13px] font-medium text-foreground">{t(key)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col gap-2">
        <Button
          type="button"
          onClick={onStart}
          className="h-11 rounded-xl bg-emerald-600 text-sm font-semibold shadow-[0_12px_28px_-14px_rgba(5,150,105,0.8)] hover:bg-emerald-700"
        >
          {t("startTour")}
          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("maybeLater")}
        </button>
      </div>
    </div>
  );
}
