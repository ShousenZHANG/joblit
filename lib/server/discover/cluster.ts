import type { Candidate, Cluster } from "./types";
import { hybridSimilarity } from "./normalize";

/**
 * Greedy text-similarity clustering.
 * Each candidate is compared to existing cluster leaders;
 * if similarity >= threshold, it joins that cluster.
 * Otherwise starts a new cluster.
 */
export function greedyCluster(
  candidates: Candidate[],
  threshold = 0.4,
): Cluster[] {
  if (candidates.length === 0) return [];

  // Sort by finalScore descending so leaders are the best items
  const sorted = [...candidates].sort(
    (a, b) => (b.finalScore || b.rrfScore) - (a.finalScore || a.rrfScore),
  );

  const groups: { leader: Candidate; members: Candidate[] }[] = [];

  for (const cand of sorted) {
    const candText = `${cand.title} ${cand.body}`.trim();
    let placed = false;

    for (const group of groups) {
      const leaderText =
        `${group.leader.title} ${group.leader.body}`.trim();
      if (hybridSimilarity(candText, leaderText) >= threshold) {
        group.members.push(cand);
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push({ leader: cand, members: [cand] });
    }
  }

  return groups.map((g, i) => {
    const allSources = new Set<string>();
    for (const m of g.members) {
      for (const s of m.sources) allSources.add(s);
    }

    return {
      id: `cluster-${i}`,
      title: g.leader.title,
      candidates: g.members,
      sources: [...allSources],
      score: g.leader.finalScore || g.leader.rrfScore,
    };
  });
}
