"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MatchBreakdown, MatchTier } from "../types";

interface MatchScoreCardProps {
  score: number | null | undefined;
  breakdown: MatchBreakdown | null | undefined;
}

// Tier accent tokens resolve via the .dark overrides in globals.css so
// the card chrome stays readable on both light and dark surfaces.
const TIER_ACCENT: Record<MatchTier, { text: string; bg: string; border: string }> = {
  strong: {
    text: "text-brand-emerald-700",
    bg: "bg-brand-emerald-50",
    border: "border-brand-emerald-200",
  },
  good: {
    text: "text-[theme(colors.tier-good-fg)]",
    bg: "bg-[theme(colors.tier-good-bg)]",
    border: "border-[theme(colors.tier-good-ring)]",
  },
  fair: {
    text: "text-[theme(colors.tier-fair-fg)]",
    bg: "bg-[theme(colors.tier-fair-bg)]",
    border: "border-[theme(colors.tier-fair-ring)]",
  },
  weak: {
    text: "text-[theme(colors.tier-weak-fg)]",
    bg: "bg-[theme(colors.tier-weak-bg)]",
    border: "border-[theme(colors.tier-weak-ring)]",
  },
};

/**
 * Compact match-score card. Single header row + one inline pill flow for
 * matched (green check) and missing (amber x) skills. The detailed
 * breakdown is intentionally removed — in user testing it read as noise
 * and no one acted on component sub-scores. The aggregate %, tier, and
 * skill delta tell the full actionable story.
 */
export function MatchScoreCard({ score, breakdown }: MatchScoreCardProps) {
  const t = useTranslations("matchScore");

  // Unscored state — prompt the user to set up their resume.
  if (score === null || score === undefined || !breakdown) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("notScored")}</span>
        <span className="ml-1 text-muted-foreground">
          · {t("notScoredDesc")}
        </span>
      </div>
    );
  }

  const tierStyle = TIER_ACCENT[breakdown.tier];
  const { matchedSkills, missingSkills } = breakdown;
  const total = matchedSkills.length + missingSkills.length;
  const tierLabel = t(`tier.${breakdown.tier}`);

  return (
    <div
      className={`rounded-lg border ${tierStyle.border} ${tierStyle.bg} px-3 py-2`}
      data-testid="match-score-card"
      data-tier={breakdown.tier}
    >
      {/* Single header row: big % + tier + skill delta */}
      <div className="flex items-baseline gap-2">
        <span className={`text-xl font-bold ${tierStyle.text}`}>
          {Math.round(score)}%
        </span>
        <span
          className={`text-[11px] font-semibold uppercase tracking-wide ${tierStyle.text}`}
        >
          {tierLabel}
        </span>
        {total > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {t("skillDelta", {
              matched: matchedSkills.length,
              total,
            })}
          </span>
        )}
      </div>

      {/* Inline pill flow — matched (emerald) then missing (amber tier) */}
      {total > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {matchedSkills.map((s) => (
            <span
              key={`m-${s}`}
              className="inline-flex items-center gap-0.5 rounded-md bg-brand-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-emerald-800"
              title={t("matched")}
            >
              <Check className="h-2.5 w-2.5" aria-hidden />
              {s}
            </span>
          ))}
          {missingSkills.map((s) => (
            <span
              key={`x-${s}`}
              className="inline-flex items-center gap-0.5 rounded-md bg-[theme(colors.tier-fair-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[theme(colors.tier-fair-fg)]"
              title={t("missing")}
            >
              <X className="h-2.5 w-2.5" aria-hidden />
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
