import type { Candidate } from "./types";
import { SOURCE_QUALITY } from "./types";

/**
 * Compute engagement score: log-normalized to 0-100.
 */
export function engagementScore(rawScore: number): number {
  if (rawScore <= 0) return 0;
  // log1p(score) / log1p(reference_max) * 100, capped at 100
  // Using 50000 as a reference max (a very popular HN post)
  const normalized = (Math.log1p(rawScore) / Math.log1p(50000)) * 100;
  return Math.min(normalized, 100);
}

/**
 * Compute freshness score: 0-100 based on how recent (days ago).
 * Exponential decay: score = 100 * e^(-lambda * days)
 * lambda calibrated so: 0 days=100, 7 days~50, 30 days~10
 */
export function freshnessScore(publishedAt: string): number {
  const daysAgo =
    (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 100; // Future date = treat as fresh
  // lambda = ln(2)/7 ≈ 0.099 gives half-life of 7 days
  const lambda = Math.LN2 / 7;
  const score = 100 * Math.exp(-lambda * daysAgo);
  return Math.max(Math.round(score * 100) / 100, 0);
}

/**
 * Compute final score for a candidate.
 * Weights: engagement 0.35, rrf 0.30, freshness 0.20, sourceQuality 0.15
 */
export function computeFinalScore(candidate: Candidate): number {
  const avgSourceQuality =
    candidate.sources.reduce(
      (sum, src) => sum + (SOURCE_QUALITY[src] ?? 0.5),
      0,
    ) / (candidate.sources.length || 1);

  const score =
    candidate.engagementScore * 0.35 +
    candidate.rrfScore * 0.30 +
    candidate.freshnessScore * 0.20 +
    avgSourceQuality * 100 * 0.15;

  return Math.min(Math.max(Math.round(score * 100) / 100, 0), 100);
}
