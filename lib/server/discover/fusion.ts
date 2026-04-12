import type { DiscoverItem, Candidate } from "./types";
import { normalizeUrl } from "./normalize";

const RRF_K = 60;

export interface RankedStream {
  label: string;
  source: string;
  weight: number;
  items: DiscoverItem[];
}

/**
 * Reciprocal Rank Fusion across multiple (label, source) streams.
 * Same item appearing in multiple streams accumulates score.
 */
export function rrfFuse(
  streams: RankedStream[],
  sourceWeights: Record<string, number>,
): Candidate[] {
  const candidateMap = new Map<string, Candidate>();

  for (const stream of streams) {
    const sw = sourceWeights[stream.source] ?? 1.0;

    for (let rank = 0; rank < stream.items.length; rank++) {
      const item = stream.items[rank];
      const key = normalizeUrl(item.url);
      const rrfContribution = (stream.weight * sw) / (RRF_K + rank + 1);

      const existing = candidateMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.items = [...existing.items, item];
        if (!existing.sources.includes(item.source)) {
          existing.sources = [...existing.sources, item.source];
        }
        // Upgrade to higher-engagement item's metadata
        if (item.engagement.score > (existing.items[0]?.engagement.score ?? 0)) {
          existing.title = item.title;
          existing.body = item.body;
          existing.author = item.author;
          existing.publishedAt = item.publishedAt;
          existing.tags = item.tags;
        }
      } else {
        candidateMap.set(key, {
          key,
          items: [item],
          sources: [item.source],
          rrfScore: rrfContribution,
          engagementScore: 0,
          freshnessScore: 0,
          sourceQualityScore: 0,
          finalScore: 0,
          title: item.title,
          url: item.url,
          body: item.body,
          author: item.author,
          publishedAt: item.publishedAt,
          tags: item.tags,
        });
      }
    }
  }

  return [...candidateMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Cap per-author items to prevent single-voice dominance.
 */
export function applyAuthorCap(
  candidates: Candidate[],
  maxPerAuthor: number,
): Candidate[] {
  const counts = new Map<string, number>();
  const result: Candidate[] = [];

  // Candidates should already be sorted by score
  for (const c of candidates) {
    const authorKey = c.author.toLowerCase().trim();
    const count = counts.get(authorKey) ?? 0;
    if (count < maxPerAuthor) {
      result.push(c);
      counts.set(authorKey, count + 1);
    }
  }

  return result;
}

/**
 * Ensure source diversity — each source gets at least minSlots
 * if it has qualifying items.
 */
export function ensureSourceDiversity(
  candidates: Candidate[],
  minSlots: number,
): Candidate[] {
  // Count how many items each source already has in the top positions
  const sourceBuckets = new Map<string, Candidate[]>();
  for (const c of candidates) {
    for (const src of c.sources) {
      const bucket = sourceBuckets.get(src) ?? [];
      bucket.push(c);
      sourceBuckets.set(src, bucket);
    }
  }

  const promoted = new Set<string>();
  const result: Candidate[] = [];

  // First: ensure each source has minSlots items
  for (const [, bucket] of sourceBuckets) {
    for (let i = 0; i < Math.min(minSlots, bucket.length); i++) {
      if (!promoted.has(bucket[i].key)) {
        promoted.add(bucket[i].key);
        result.push(bucket[i]);
      }
    }
  }

  // Then: fill remaining by score order
  for (const c of candidates) {
    if (!promoted.has(c.key)) {
      promoted.add(c.key);
      result.push(c);
    }
  }

  // Re-sort by finalScore (or rrfScore as fallback)
  return result.sort(
    (a, b) => (b.finalScore || b.rrfScore) - (a.finalScore || a.rrfScore),
  );
}
