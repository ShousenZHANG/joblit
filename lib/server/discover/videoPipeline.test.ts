import { beforeEach, describe, it, expect, vi } from "vitest";

const safeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/net/safeFetch", () => ({
  safeOutboundFetch: safeFetchMock,
}));

import {
  fetchVideosFromYouTube,
  queriesForCategory,
  scoreRelevance,
  searchOrderForSort,
  trustScore,
  engagementScore,
  recencyScore,
  computeTrendingScore,
  type ScorableVideo,
} from "./videoPipeline";

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("YouTube outbound policy", () => {
  it("routes search, video, and channel calls through one exact-host policy", async () => {
    for (let index = 0; index < 4; index += 1) {
      safeFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: { videoId: "video-1" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "video-1",
              snippet: {
                title: "Claude coding agent deep dive",
                thumbnails: { medium: { url: "https://i.ytimg.com/thumb.jpg" } },
                channelTitle: "Engineering",
                channelId: "channel-1",
                publishedAt: "2026-07-19T00:00:00.000Z",
                description: "Claude agent tutorial",
              },
              statistics: { viewCount: "1000", likeCount: "50" },
              contentDetails: { duration: "PT10M" },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "channel-1",
              statistics: { subscriberCount: "5000" },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const videos = await fetchVideosFromYouTube(
      "claude",
      "month",
      "test-api-key",
    );

    expect(videos).toHaveLength(1);
    expect(safeFetchMock).toHaveBeenCalledTimes(6);
    for (const [input, init, policy] of safeFetchMock.mock.calls) {
      expect(input).toBeInstanceOf(URL);
      expect((input as URL).hostname).toBe("www.googleapis.com");
      expect(init).toEqual({});
      expect(policy).toEqual({
        allowedHosts: ["www.googleapis.com"],
        timeoutMs: 8_000,
        maxResponseBytes: 1024 * 1024,
        maxRedirects: 0,
      });
    }
  });
});

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
