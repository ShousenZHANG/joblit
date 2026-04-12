import { describe, it, expect } from "vitest";
import { engagementScore, freshnessScore, computeFinalScore } from "./scoring";
import type { Candidate } from "./types";

// ── engagementScore ──

describe("engagementScore", () => {
  it("returns 0 for zero engagement", () => {
    expect(engagementScore(0)).toBe(0);
  });

  it("returns a value between 0-100 for normal engagement", () => {
    const score = engagementScore(500);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("higher engagement produces higher score", () => {
    expect(engagementScore(1000)).toBeGreaterThan(engagementScore(100));
    expect(engagementScore(10000)).toBeGreaterThan(engagementScore(1000));
  });

  it("is logarithmic — diminishing returns for very high values", () => {
    const diff1 = engagementScore(100) - engagementScore(1);
    const diff2 = engagementScore(10000) - engagementScore(100);
    // Wider range: 1→100 vs 100→10000, second jump should yield less gain per unit
    expect(diff2).toBeLessThan(diff1 * 3);
    // And the curve flattens: score at 50000 is close to 100
    expect(engagementScore(50000)).toBeGreaterThan(90);
  });

  it("caps at 100", () => {
    expect(engagementScore(1_000_000)).toBeLessThanOrEqual(100);
  });
});

// ── freshnessScore ──

describe("freshnessScore", () => {
  it("returns 100 for just-published content", () => {
    expect(freshnessScore(new Date().toISOString())).toBeCloseTo(100, 0);
  });

  it("returns ~50 for 7-day-old content", () => {
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(freshnessScore(sevenDaysAgo)).toBeCloseTo(50, 5);
  });

  it("returns low score for 30-day-old content", () => {
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const score = freshnessScore(thirtyDaysAgo);
    // With half-life=7 days: 100 * e^(-ln2/7 * 30) ≈ 5.1
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(15);
  });

  it("returns 0 for very old content", () => {
    expect(freshnessScore("2020-01-01T00:00:00Z")).toBe(0);
  });

  it("never returns negative", () => {
    expect(freshnessScore("1990-01-01T00:00:00Z")).toBeGreaterThanOrEqual(0);
  });
});

// ── computeFinalScore ──

describe("computeFinalScore", () => {
  function makeCand(overrides: Partial<Candidate> = {}): Candidate {
    return {
      key: "k",
      items: [],
      sources: ["hn"],
      rrfScore: 50,
      engagementScore: 50,
      freshnessScore: 50,
      sourceQualityScore: 80,
      finalScore: 0,
      title: "Test",
      url: "https://example.com",
      body: "",
      author: "alice",
      publishedAt: new Date().toISOString(),
      tags: [],
      ...overrides,
    };
  }

  it("returns a value between 0-100", () => {
    const score = computeFinalScore(makeCand());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("higher engagement raises the final score", () => {
    const low = computeFinalScore(makeCand({ engagementScore: 10 }));
    const high = computeFinalScore(makeCand({ engagementScore: 90 }));
    expect(high).toBeGreaterThan(low);
  });

  it("higher RRF raises the final score", () => {
    const low = computeFinalScore(makeCand({ rrfScore: 10 }));
    const high = computeFinalScore(makeCand({ rrfScore: 90 }));
    expect(high).toBeGreaterThan(low);
  });

  it("fresher content scores higher", () => {
    const stale = computeFinalScore(makeCand({ freshnessScore: 10 }));
    const fresh = computeFinalScore(makeCand({ freshnessScore: 90 }));
    expect(fresh).toBeGreaterThan(stale);
  });
});
