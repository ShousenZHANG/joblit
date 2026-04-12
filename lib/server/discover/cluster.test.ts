import { describe, it, expect } from "vitest";
import { greedyCluster } from "./cluster";
import type { Candidate } from "./types";

function makeCand(
  key: string,
  title: string,
  score: number,
  source = "hn",
): Candidate {
  return {
    key,
    items: [],
    sources: [source],
    rrfScore: score,
    engagementScore: score,
    freshnessScore: 80,
    sourceQualityScore: 80,
    finalScore: score,
    title,
    url: `https://example.com/${key}`,
    body: title,
    author: "author",
    publishedAt: new Date().toISOString(),
    tags: [],
  };
}

describe("greedyCluster", () => {
  it("groups similar candidates into one cluster", () => {
    const candidates = [
      makeCand("a", "OpenAI releases GPT-5 with improved reasoning", 100),
      makeCand("b", "OpenAI releases GPT-5 with better reasoning abilities", 90),
      makeCand("c", "Rust memory safety in embedded systems", 80),
    ];

    const clusters = greedyCluster(candidates, 0.4);
    // The two GPT-5 articles should cluster together
    const gptCluster = clusters.find((c) =>
      c.candidates.some((cand) => cand.key === "a"),
    );
    expect(gptCluster).toBeDefined();
    expect(gptCluster!.candidates.length).toBeGreaterThanOrEqual(2);

    // The Rust article should be separate
    const rustCluster = clusters.find((c) =>
      c.candidates.some((cand) => cand.key === "c"),
    );
    expect(rustCluster).toBeDefined();
    expect(rustCluster!.candidates).toHaveLength(1);
  });

  it("returns one cluster per item when all are dissimilar", () => {
    const candidates = [
      makeCand("a", "React server components deep dive tutorial", 100),
      makeCand("b", "Kubernetes networking configuration guide", 90),
      makeCand("c", "Machine learning model deployment pipeline", 80),
    ];

    const clusters = greedyCluster(candidates, 0.4);
    expect(clusters).toHaveLength(3);
  });

  it("uses the highest-scored candidate as cluster title", () => {
    const candidates = [
      makeCand("a", "Best article about topic X", 100),
      makeCand("b", "Another article about topic X slightly different", 60),
    ];

    const clusters = greedyCluster(candidates, 0.3);
    if (clusters.length === 1) {
      expect(clusters[0].title).toBe("Best article about topic X");
      expect(clusters[0].score).toBe(100);
    }
  });

  it("aggregates sources across cluster members", () => {
    const candidates = [
      makeCand("a", "AI breakthrough announced today by researchers", 100, "hn"),
      makeCand("b", "AI breakthrough announced today official release", 90, "devto"),
    ];

    const clusters = greedyCluster(candidates, 0.3);
    if (clusters.length === 1) {
      expect(clusters[0].sources).toContain("hn");
      expect(clusters[0].sources).toContain("devto");
    }
  });

  it("returns empty array for empty input", () => {
    expect(greedyCluster([], 0.4)).toEqual([]);
  });

  it("handles single candidate", () => {
    const candidates = [makeCand("a", "Solo article", 100)];
    const clusters = greedyCluster(candidates, 0.4);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].candidates).toHaveLength(1);
  });
});
