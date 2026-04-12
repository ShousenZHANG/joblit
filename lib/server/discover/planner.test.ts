import { describe, it, expect } from "vitest";
import { detectIntent, buildQueryPlan } from "./planner";

// ── detectIntent ──

describe("detectIntent", () => {
  it("detects comparison intent from 'vs'", () => {
    expect(detectIntent("React vs Vue")).toBe("comparison");
  });

  it("detects comparison intent from 'compare'", () => {
    expect(detectIntent("compare Python and Go")).toBe("comparison");
  });

  it("detects how_to intent", () => {
    expect(detectIntent("how to deploy Next.js")).toBe("how_to");
  });

  it("detects how_to from 'tutorial'", () => {
    expect(detectIntent("React tutorial")).toBe("how_to");
  });

  it("detects trending intent", () => {
    expect(detectIntent("trending AI repos")).toBe("trending");
  });

  it("detects breaking_news intent", () => {
    expect(detectIntent("OpenAI just announced GPT-5")).toBe("breaking_news");
  });

  it("defaults to general for ambiguous queries", () => {
    expect(detectIntent("machine learning")).toBe("general");
  });

  it("is case insensitive", () => {
    expect(detectIntent("HOW TO build an API")).toBe("how_to");
  });
});

// ── buildQueryPlan ──

describe("buildQueryPlan", () => {
  const sources = ["github", "hn", "devto"];

  it("returns a valid plan with subqueries", () => {
    const plan = buildQueryPlan("machine learning", sources);
    expect(plan.intent).toBe("general");
    expect(plan.subqueries.length).toBeGreaterThanOrEqual(1);
    expect(plan.sourceWeights).toBeDefined();
  });

  it("creates multiple subqueries for comparisons", () => {
    const plan = buildQueryPlan("React vs Vue", sources);
    expect(plan.intent).toBe("comparison");
    expect(plan.subqueries.length).toBeGreaterThanOrEqual(2);
    // Should have entity-specific subqueries
    const labels = plan.subqueries.map((sq) => sq.label);
    expect(labels.some((l) => l !== "primary")).toBe(true);
  });

  it("assigns higher weight to relevant sources per intent", () => {
    const plan = buildQueryPlan("trending GitHub repos", sources);
    expect(plan.sourceWeights.github).toBeGreaterThanOrEqual(
      plan.sourceWeights.devto ?? 0,
    );
  });

  it("only includes available sources in subqueries", () => {
    const plan = buildQueryPlan("test query", ["hn"]);
    for (const sq of plan.subqueries) {
      for (const src of sq.sources) {
        expect(sources).toContain(src);
      }
    }
  });

  it("subquery weights are positive", () => {
    const plan = buildQueryPlan("some query", sources);
    for (const sq of plan.subqueries) {
      expect(sq.weight).toBeGreaterThan(0);
    }
  });
});
