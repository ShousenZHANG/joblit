"use client";

import type { MatchBreakdown, MatchTier } from "../types";

interface MatchScoreBadgeProps {
  score: number | null | undefined;
  breakdown?: MatchBreakdown | null;
  size?: "sm" | "md";
  title?: string;
}

const TIER_STYLE: Record<MatchTier, string> = {
  strong: "bg-brand-emerald-100 text-brand-emerald-800 ring-brand-emerald-200",
  good: "bg-teal-100 text-teal-800 ring-teal-200",
  fair: "bg-amber-100 text-amber-800 ring-amber-200",
  weak: "bg-slate-200 text-muted-foreground ring-slate-300",
};

function scoreToTier(score: number): MatchTier {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 45) return "fair";
  return "weak";
}

/**
 * Small pill showing "85%" with a tier-coloured background. Renders nothing
 * (empty fragment) when the job has no score yet — lets callers place it
 * in a flex row without reserving space for an absent score.
 */
export function MatchScoreBadge({
  score,
  breakdown,
  size = "sm",
  title,
}: MatchScoreBadgeProps) {
  if (score === null || score === undefined) return null;
  const tier = breakdown?.tier ?? scoreToTier(score);
  const sizeClass = size === "sm"
    ? "text-[10px] px-1.5 py-0.5"
    : "text-xs px-2 py-0.5";
  const tooltip =
    title ??
    (breakdown
      ? `${breakdown.matchedSkills.length} matched · ${breakdown.missingSkills.length} missing`
      : `${Math.round(score)}% match`);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold ring-1 ring-inset ${TIER_STYLE[tier]} ${sizeClass}`}
      title={tooltip}
      aria-label={tooltip}
      data-tier={tier}
    >
      {Math.round(score)}%
    </span>
  );
}
