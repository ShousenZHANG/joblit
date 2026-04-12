import type { QueryPlan, Intent, SubQuery } from "./types";

const INTENT_PATTERNS: [RegExp, Intent][] = [
  [/\bvs\b|versus|\bcompare\b|\bcomparison\b/i, "comparison"],
  [/\bhow\s+to\b|\btutorial\b|\bguide\b|\bsetup\b|\binstall\b/i, "how_to"],
  [/\btrending\b|\bpopular\b|\bhot\b|\btop\b|\bbest\b/i, "trending"],
  [/\bbreaking\b|\bjust\b|\bannounced\b|\breleased?\b|\blaunch/i, "breaking_news"],
];

const INTENT_SOURCE_WEIGHTS: Record<Intent, Record<string, number>> = {
  general: { github: 1.0, hn: 1.0, devto: 1.0 },
  comparison: { github: 0.8, hn: 1.3, devto: 1.2 },
  trending: { github: 1.5, hn: 1.0, devto: 0.8 },
  breaking_news: { github: 0.6, hn: 1.5, devto: 1.0 },
  how_to: { github: 0.7, hn: 0.8, devto: 1.5 },
};

/**
 * Detect query intent from keywords (no LLM needed).
 */
export function detectIntent(query: string): Intent {
  for (const [pattern, intent] of INTENT_PATTERNS) {
    if (pattern.test(query)) return intent;
  }
  return "general";
}

/**
 * Extract entities from comparison queries (e.g., "React vs Vue" → ["React", "Vue"]).
 */
function extractComparisonEntities(query: string): string[] {
  // Match "A vs B", "A versus B", "compare A and B"
  const vsMatch = query.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+)/i);
  if (vsMatch) return [vsMatch[1].trim(), vsMatch[2].trim()];

  const compareMatch = query.match(
    /compare\s+(.+?)\s+(?:and|with|to)\s+(.+)/i,
  );
  if (compareMatch) return [compareMatch[1].trim(), compareMatch[2].trim()];

  return [];
}

/**
 * Build a query plan: decompose query into subqueries,
 * assign source weights based on intent.
 */
export function buildQueryPlan(
  query: string,
  availableSources: string[],
): QueryPlan {
  const intent = detectIntent(query);
  const baseWeights = INTENT_SOURCE_WEIGHTS[intent];

  // Filter to only available sources
  const sourceWeights: Record<string, number> = {};
  for (const src of availableSources) {
    sourceWeights[src] = baseWeights[src] ?? 1.0;
  }

  const subqueries: SubQuery[] = [];

  if (intent === "comparison") {
    const entities = extractComparisonEntities(query);
    if (entities.length >= 2) {
      // Primary: the full comparison query
      subqueries.push({
        label: "primary",
        searchQuery: query,
        sources: availableSources,
        weight: 1.0,
      });
      // Entity-specific subqueries
      for (const entity of entities) {
        subqueries.push({
          label: `entity-${entity.toLowerCase().replace(/\s+/g, "-")}`,
          searchQuery: entity,
          sources: availableSources,
          weight: 0.65,
        });
      }
    } else {
      // Can't extract entities, use full query
      subqueries.push({
        label: "primary",
        searchQuery: query,
        sources: availableSources,
        weight: 1.0,
      });
    }
  } else if (intent === "breaking_news") {
    subqueries.push({
      label: "primary",
      searchQuery: query,
      sources: availableSources,
      weight: 1.0,
    });
    // Add a reaction subquery
    const coreSubject = query
      .replace(
        /\b(breaking|just|announced|released?|launch(?:ed|es)?)\b/gi,
        "",
      )
      .trim();
    if (coreSubject.length > 3) {
      subqueries.push({
        label: "reactions",
        searchQuery: `${coreSubject} reaction`,
        sources: availableSources,
        weight: 0.7,
      });
    }
  } else {
    // General, trending, how_to: single primary subquery
    subqueries.push({
      label: "primary",
      searchQuery: query,
      sources: availableSources,
      weight: 1.0,
    });
  }

  return { intent, subqueries, sourceWeights };
}
