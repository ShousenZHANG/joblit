/** Unified item from any data source, after normalization. */
export interface DiscoverItem {
  id: string;
  source: string;
  title: string;
  url: string;
  body: string;
  author: string;
  publishedAt: string;
  engagement: { score: number; comments: number };
  relevance: number;
  tags: string[];
}

/** Post-fusion candidate with cross-source scoring. */
export interface Candidate {
  /** Dedup key (normalized URL or source:id). */
  key: string;
  items: DiscoverItem[];
  sources: string[];
  rrfScore: number;
  engagementScore: number;
  freshnessScore: number;
  sourceQualityScore: number;
  finalScore: number;
  /** Best title from highest-engagement item. */
  title: string;
  url: string;
  body: string;
  author: string;
  publishedAt: string;
  tags: string[];
}

/** A cluster of related candidates. */
export interface Cluster {
  id: string;
  title: string;
  candidates: Candidate[];
  sources: string[];
  score: number;
}

/** Subquery produced by intent detection. */
export interface SubQuery {
  label: string;
  searchQuery: string;
  sources: string[];
  weight: number;
}

export type Intent =
  | "general"
  | "comparison"
  | "trending"
  | "breaking_news"
  | "how_to";

export interface QueryPlan {
  intent: Intent;
  subqueries: SubQuery[];
  sourceWeights: Record<string, number>;
}

/** Source quality baselines (0-1). */
export const SOURCE_QUALITY: Record<string, number> = {
  github: 0.85,
  hn: 0.80,
  devto: 0.65,
};
