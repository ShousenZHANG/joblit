"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MatchBreakdown, MatchTier } from "../types";

interface MatchScoreCardProps {
  score: number | null | undefined;
  breakdown: MatchBreakdown | null | undefined;
}

const TIER_ACCENT: Record<MatchTier, { text: string; bg: string; border: string }> = {
  strong: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  good:   { text: "text-teal-700",    bg: "bg-teal-50",    border: "border-teal-200"    },
  fair:   { text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200"   },
  weak:   { text: "text-slate-600",   bg: "bg-slate-50",   border: "border-slate-200"   },
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
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-700">{t("notScored")}</span>
        <span className="ml-1 text-slate-500">· {t("notScoredDesc")}</span>
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
          <span className="ml-auto text-[11px] text-slate-500">
            {t("skillDelta", {
              matched: matchedSkills.length,
              total,
            })}
          </span>
        )}
      </div>

      {/* Inline pill flow — matched (green) then missing (amber) */}
      {total > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {matchedSkills.map((s) => (
            <span
              key={`m-${s}`}
              className="inline-flex items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800"
              title={t("matched")}
            >
              <Check className="h-2.5 w-2.5" aria-hidden />
              {s}
            </span>
          ))}
          {missingSkills.map((s) => (
            <span
              key={`x-${s}`}
              className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
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
