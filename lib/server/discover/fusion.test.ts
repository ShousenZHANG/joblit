import { describe, it, expect } from "vitest";
import { rrfFuse, applyAuthorCap, ensureSourceDiversity } from "./fusion";
import type { DiscoverItem, Candidate } from "./types";

function makeItem(overrides: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: "item-1",
    source: "hn",
    title: "Test Article",
    url: "https://example.com/article",
    body: "Article body text",
    author: "alice",
    publishedAt: new Date().toISOString(),
    engagement: { score: 100, comments: 10 },
    relevance: 0.8,
    tags: [],
    ...overrides,
  };
}

// ── rrfFuse ──

describe("rrfFuse", () => {
  it("assigns higher score to items appearing in multiple streams", () => {
    const sharedUrl = "https://example.com/hot-article";
    const streams = [
      {
        label: "primary",
        source: "hn",
        weight: 1.0,
        items: [
          makeItem({ id: "hn-1", source: "hn", url: sharedUrl, title: "Hot Article" }),
          makeItem({ id: "hn-2", source: "hn", url: "https://example.com/hn-only" }),
        ],
      },
      {
        label: "primary",
        source: "devto",
        weight: 1.0,
        items: [
          makeItem({ id: "devto-1", source: "devto", url: sharedUrl, title: "Hot Article" }),
          makeItem({ id: "devto-2", source: "devto", url: "https://example.com/devto-only" }),
        ],
      },
    ];

    const result = rrfFuse(streams, { hn: 1.0, devto: 1.0 });
    const shared = result.find((c) => c.url === sharedUrl);
    const hnOnly = result.find((c) => c.url === "https://example.com/hn-only");

    expect(shared).toBeDefined();
    expect(hnOnly).toBeDefined();
    expect(shared!.rrfScore).toBeGreaterThan(hnOnly!.rrfScore);
    expect(shared!.sources).toContain("hn");
    expect(shared!.sources).toContain("devto");
  });

  it("applies source weights to RRF scores", () => {
    const streams = [
      {
        label: "primary",
        source: "hn",
        weight: 1.0,
        items: [makeItem({ id: "hn-1", source: "hn", url: "https://a.com" })],
      },
      {
        label: "primary",
        source: "devto",
        weight: 1.0,
        items: [makeItem({ id: "devto-1", source: "devto", url: "https://b.com" })],
      },
    ];

    const highHn = rrfFuse(streams, { hn: 2.0, devto: 0.5 });
    const hnItem = highHn.find((c) => c.sources.includes("hn"));
    const devtoItem = highHn.find((c) => c.sources.includes("devto"));

    expect(hnItem!.rrfScore).toBeGreaterThan(devtoItem!.rrfScore);
  });

  it("returns empty array for empty streams", () => {
    expect(rrfFuse([], {})).toEqual([]);
  });

  it("merges items from same source into one candidate", () => {
    const url = "https://example.com/same";
    const streams = [
      {
        label: "q1",
        source: "hn",
        weight: 1.0,
        items: [makeItem({ id: "hn-1", url })],
      },
      {
        label: "q2",
        source: "hn",
        weight: 0.8,
        items: [makeItem({ id: "hn-1-dup", url })],
      },
    ];

    const result = rrfFuse(streams, { hn: 1.0 });
    const matches = result.filter((c) => c.url === url);
    expect(matches).toHaveLength(1);
    expect(matches[0].items).toHaveLength(2);
  });
});

// ── applyAuthorCap ──

describe("applyAuthorCap", () => {
  function makeCand(author: string, score: number): Candidate {
    return {
      key: `key-${author}-${score}`,
      items: [],
      sources: ["hn"],
      rrfScore: score,
      engagementScore: 0,
      freshnessScore: 0,
      sourceQualityScore: 0,
      finalScore: score,
      title: `Article by ${author}`,
      url: `https://example.com/${author}/${score}`,
      body: "",
      author,
      publishedAt: new Date().toISOString(),
      tags: [],
    };
  }

  it("keeps at most maxPerAuthor items per author", () => {
    const candidates = [
      makeCand("alice", 100),
      makeCand("alice", 90),
      makeCand("alice", 80),
      makeCand("alice", 70),
      makeCand("bob", 95),
    ];

    const result = applyAuthorCap(candidates, 2);
    const aliceItems = result.filter((c) => c.author === "alice");
    expect(aliceItems).toHaveLength(2);
    // Should keep the highest-scored ones
    expect(aliceItems[0].finalScore).toBe(100);
    expect(aliceItems[1].finalScore).toBe(90);
  });

  it("does not modify candidates within the cap", () => {
    const candidates = [makeCand("alice", 100), makeCand("bob", 90)];
    const result = applyAuthorCap(candidates, 2);
    expect(result).toHaveLength(2);
  });
});

// ── ensureSourceDiversity ──

describe("ensureSourceDiversity", () => {
  function makeCandWithSource(source: string, score: number): Candidate {
    return {
      key: `key-${source}-${score}`,
      items: [],
      sources: [source],
      rrfScore: score,
      engagementScore: 0,
      freshnessScore: 0,
      sourceQualityScore: 0,
      finalScore: score,
      title: `From ${source}`,
      url: `https://${source}.com/${score}`,
      body: "",
      author: "someone",
      publishedAt: new Date().toISOString(),
      tags: [],
    };
  }

  it("promotes underrepresented sources into top results", () => {
    // 8 HN items dominate, 2 devto items at the bottom
    const candidates = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeCandWithSource("hn", 100 - i),
      ),
      makeCandWithSource("devto", 50),
      makeCandWithSource("devto", 45),
    ];

    const result = ensureSourceDiversity(candidates, 2);
    // devto should have at least 2 items in the result
    const devtoCount = result.filter((c) => c.sources.includes("devto")).length;
    expect(devtoCount).toBeGreaterThanOrEqual(2);
  });

  it("does not duplicate candidates", () => {
    const candidates = [
      makeCandWithSource("hn", 100),
      makeCandWithSource("devto", 90),
      makeCandWithSource("github", 80),
    ];
    const result = ensureSourceDiversity(candidates, 1);
    const keys = result.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
