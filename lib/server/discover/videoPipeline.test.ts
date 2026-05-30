import { describe, it, expect } from "vitest";
import {
  queriesForCategory,
  scoreRelevance,
  searchOrderForSort,
  ALL_VIDEO_CACHE_COMBOS,
  trustScore,
  engagementScore,
  recencyScore,
  computeTrendingScore,
  type ScorableVideo,
} from "./videoPipeline";

describe("queriesForCategory", () => {
  it('"all" returns exactly one query per sub-category (quota-safe)', () => {
    const queries = queriesForCategory("all");
    // Seven sub-categories, one query each, well under the previous 25.
    expect(queries.length).toBe(7);
    // No duplicates.
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("returns at most 4 queries per specific category", () => {
    for (const cat of [
      "claude",
      "codex",
      "anthropic",
      "rag",
      "agents",
      "agent-skills",
      "harness-engineering",
    ] as const) {
      const queries = queriesForCategory(cat);
      expect(queries.length).toBeLessThanOrEqual(4);
      expect(queries.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same input", () => {
    expect(queriesForCategory("claude")).toEqual(queriesForCategory("claude"));
  });

  it("includes Codex-specific search intent", () => {
    const text = queriesForCategory("codex").join(" ").toLowerCase();
    expect(text).toContain("codex");
    expect(text).toContain("openai");
  });
});

describe("scoreRelevance", () => {
  it("returns 0 for text with no category keywords", () => {
    expect(scoreRelevance("a story about cats", "rag")).toBe(0);
  });

  it("scores 1/3 for a single matching keyword", () => {
    expect(scoreRelevance("intro to claude", "claude")).toBeCloseTo(
      1 / 3,
      5,
    );
  });

  it("saturates at 1.0 after three matches", () => {
    expect(
      scoreRelevance(
        "agent agentic autonomous tool use function call",
        "agents",
      ),
    ).toBe(1);
  });

  it('"all" takes the max across every sub-category', () => {
    // text matches 3 claude keywords → all-category score should also be 1
    expect(
      scoreRelevance("claude anthropic sonnet opus", "all"),
    ).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(scoreRelevance("CLAUDE SONNET", "claude")).toBeGreaterThan(0);
  });

  it("scores Codex coding-agent content", () => {
    expect(
      scoreRelevance("OpenAI Codex CLI coding agent tutorial", "codex"),
    ).toBeGreaterThan(0);
  });
});

describe("searchOrderForSort", () => {
  it("maps UI sort options to YouTube search orders", () => {
    expect(searchOrderForSort("trending")).toBe("relevance");
    expect(searchOrderForSort("latest")).toBe("date");
    expect(searchOrderForSort("most_viewed")).toBe("viewCount");
  });
});

describe("ALL_VIDEO_CACHE_COMBOS", () => {
  it("covers 16 (cat, window) pairs: 8 categories x 2 windows", () => {
    expect(ALL_VIDEO_CACHE_COMBOS.length).toBe(16);
  });

  it("contains every category exactly twice (once per window)", () => {
    const counts = new Map<string, number>();
    for (const c of ALL_VIDEO_CACHE_COMBOS) {
      counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    }
    for (const n of counts.values()) expect(n).toBe(2);
  });

  it("has no duplicate (category, window) pairs", () => {
    const keys = ALL_VIDEO_CACHE_COMBOS.map(
      (c) => `${c.category}:${c.timeWindow}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("video trending score", () => {
  const base: ScorableVideo = {
    relevanceScore: 0.5,
    trustTier: 0,
    viewCount: 1000,
    likeCount: 50,
    publishedAt: new Date().toISOString(),
  };

  it("trustScore ranks tier 1 > 2 > 3 > untrusted", () => {
    expect(trustScore(1)).toBeGreaterThan(trustScore(2));
    expect(trustScore(2)).toBeGreaterThan(trustScore(3));
    expect(trustScore(3)).toBeGreaterThan(trustScore(0));
    expect(trustScore(0)).toBe(0);
  });

  it("engagementScore rises with views and like ratio, bounded 0..1", () => {
    expect(engagementScore(1_000_000, 50_000)).toBeGreaterThan(
      engagementScore(100, 1),
    );
    expect(engagementScore(0, 0)).toBe(0);
    expect(engagementScore(10_000_000, 1_000_000)).toBeLessThanOrEqual(1);
  });

  it("recencyScore decays from 1 (new) toward 0 (window edge)", () => {
    const fresh = recencyScore(new Date().toISOString(), 30);
    const old = recencyScore(
      new Date(Date.now() - 29 * 86_400_000).toISOString(),
      30,
    );
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThanOrEqual(0);
  });

  it("a relevant trusted high-engagement video outranks an off-topic untrusted one", () => {
    const good = computeTrendingScore(
      { ...base, relevanceScore: 1, trustTier: 1, viewCount: 500_000, likeCount: 30_000 },
      30,
    );
    const bad = computeTrendingScore(
      { ...base, relevanceScore: 0, trustTier: 0, viewCount: 200, likeCount: 1 },
      30,
    );
    expect(good).toBeGreaterThan(bad);
  });

  it("handles an unparseable publish date without throwing", () => {
    expect(recencyScore("not-a-date", 30)).toBe(0);
  });
});
