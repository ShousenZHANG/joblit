/**
 * Discover pipeline — orchestrates normalization, fusion, scoring, and clustering.
 * Used by API routes to process raw source data into ranked, deduplicated results.
 */
import type { DiscoverItem, Candidate, Cluster } from "./types";
import { SOURCE_QUALITY } from "./types";
import { normalizeUrl, hybridSimilarity } from "./normalize";
import { rrfFuse, applyAuthorCap, ensureSourceDiversity, type RankedStream } from "./fusion";
import { engagementScore, freshnessScore, computeFinalScore } from "./scoring";
import { greedyCluster } from "./cluster";

export type { DiscoverItem, Candidate, Cluster };

const DEDUP_THRESHOLD = 0.7;

/**
 * Deduplicate items within a single source stream using hybrid similarity.
 */
function deduplicateStream(items: DiscoverItem[]): DiscoverItem[] {
  const kept: DiscoverItem[] = [];
  for (const item of items) {
    const text = `${item.title} ${item.body}`;
    const isDupe = kept.some(
      (k) => hybridSimilarity(`${k.title} ${k.body}`, text) >= DEDUP_THRESHOLD,
    );
    if (!isDupe) kept.push(item);
  }
  return kept;
}

export interface PipelineInput {
  streams: RankedStream[];
  sourceWeights: Record<string, number>;
  authorCap?: number;
  minSourceSlots?: number;
  clusterThreshold?: number;
}

export interface PipelineOutput {
  candidates: Candidate[];
  clusters: Cluster[];
}

/**
 * Run the full discover pipeline:
 * 1. Within-stream dedup
 * 2. RRF cross-source fusion
 * 3. Signal scoring (engagement, freshness, source quality)
 * 4. Final score computation
 * 5. Author cap + source diversity
 * 6. Greedy clustering
 */
export function runPipeline(input: PipelineInput): PipelineOutput {
  const {
    streams,
    sourceWeights,
    authorCap = 3,
    minSourceSlots = 2,
    clusterThreshold = 0.4,
  } = input;

  // 1. Within-stream dedup
  const dedupedStreams: RankedStream[] = streams.map((s) => ({
    ...s,
    items: deduplicateStream(s.items),
  }));

  // 2. RRF fusion
  let candidates = rrfFuse(dedupedStreams, sourceWeights);

  // 3. Signal scoring
  for (const c of candidates) {
    const bestEngagement = Math.max(
      ...c.items.map((it) => it.engagement.score),
    );
    c.engagementScore = engagementScore(bestEngagement);
    c.freshnessScore = freshnessScore(c.publishedAt);
    c.sourceQualityScore =
      (c.sources.reduce((s, src) => s + (SOURCE_QUALITY[src] ?? 0.5), 0) /
        c.sources.length) *
      100;
  }

  // 4. Normalize RRF scores to 0-100 range, then compute final
  const maxRrf = Math.max(...candidates.map((c) => c.rrfScore), 0.001);
  for (const c of candidates) {
    c.rrfScore = (c.rrfScore / maxRrf) * 100;
    c.finalScore = computeFinalScore(c);
  }

  // Sort by final score
  candidates.sort((a, b) => b.finalScore - a.finalScore);

  // 5. Author cap + source diversity
  candidates = applyAuthorCap(candidates, authorCap);
  candidates = ensureSourceDiversity(candidates, minSourceSlots);

  // 6. Clustering
  const clusters = greedyCluster(candidates, clusterThreshold);

  return { candidates, clusters };
}
