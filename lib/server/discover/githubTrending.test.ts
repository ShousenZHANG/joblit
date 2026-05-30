import { describe, it, expect } from "vitest";
import {
  cjkRatio,
  isMostlyCjk,
  isLowSignalRepo,
  passesQualityGate,
  rankRepos,
} from "./githubTrending";
import type { TrendingRepo } from "@/app/(app)/discover/types";

function repo(over: Partial<TrendingRepo & { archived: boolean }> = {}) {
  return {
    id: 1,
    fullName: "acme/widget",
    description: "A fast widget framework.",
    url: "https://github.com/acme/widget",
    stars: 1000,
    forks: 10,
    language: "TypeScript",
    topics: [],
    ownerAvatar: "",
    pushedAt: "",
    archived: false,
    ...over,
  };
}

describe("cjkRatio / isMostlyCjk", () => {
  it("is ~0 for English text", () => {
    expect(cjkRatio("A fast widget framework")).toBeLessThan(0.05);
    expect(isMostlyCjk("A fast widget framework")).toBe(false);
  });
  it("flags predominantly Chinese text", () => {
    expect(isMostlyCjk("最全面的前端面试题学习资料")).toBe(true);
  });
  it("keeps a mostly-English repo that has a couple CJK chars", () => {
    expect(isMostlyCjk("Vite plugin for 中文 docs")).toBe(false);
  });
});

describe("isLowSignalRepo", () => {
  it("drops awesome lists, roadmaps, interview/tutorial repos", () => {
    expect(isLowSignalRepo("sindresorhus/awesome-nodejs", "A curated list")).toBe(true);
    expect(isLowSignalRepo("kamranahmedse/developer-roadmap", "Roadmaps")).toBe(true);
    expect(isLowSignalRepo("user/coding-interview-university", "prep")).toBe(true);
    expect(isLowSignalRepo("EbookFoundation/free-programming-books", "books")).toBe(true);
  });
  it("keeps real software", () => {
    expect(isLowSignalRepo("vercel/next.js", "The React framework")).toBe(false);
    expect(isLowSignalRepo("acme/widget", "A fast widget framework.")).toBe(false);
  });
});

describe("passesQualityGate", () => {
  it("requires a description", () => {
    expect(passesQualityGate(repo({ description: null }), 100)).toBe(false);
    expect(passesQualityGate(repo({ description: "" }), 100)).toBe(false);
  });
  it("drops archived + below-floor + mostly-CJK + low-signal", () => {
    expect(passesQualityGate(repo({ archived: true }), 100)).toBe(false);
    expect(passesQualityGate(repo({ stars: 40 }), 100)).toBe(false);
    expect(
      passesQualityGate(repo({ fullName: "x/面试", description: "最全面试题资料库" }), 100),
    ).toBe(false);
    expect(
      passesQualityGate(repo({ fullName: "x/awesome-go", description: "A curated list" }), 100),
    ).toBe(false);
  });
  it("passes a genuinely popular project", () => {
    expect(passesQualityGate(repo({ stars: 2500 }), 100)).toBe(true);
  });
});

describe("rankRepos", () => {
  it("filters noise, sorts by stars desc, trims to 20", () => {
    const input = [
      repo({ id: 1, fullName: "a/awesome-x", description: "curated", stars: 9000 }),
      repo({ id: 2, fullName: "b/real", description: "Real tool", stars: 300 }),
      repo({ id: 3, fullName: "c/real2", description: "Another", stars: 800 }),
      repo({ id: 4, fullName: "d/noDesc", description: null, stars: 5000 }),
    ];
    const out = rankRepos(input, "weekly");
    expect(out.map((r) => r.id)).toEqual([3, 2]); // awesome + noDesc dropped, sorted desc
    // archived helper field is stripped from the public shape
    expect((out[0] as Record<string, unknown>).archived).toBeUndefined();
  });

  it("applies the higher monthly floor", () => {
    const input = [repo({ id: 1, description: "Real", stars: 300 })];
    expect(rankRepos(input, "weekly").length).toBe(1); // floor 100
    expect(rankRepos(input, "monthly").length).toBe(0); // floor 500
  });
});
