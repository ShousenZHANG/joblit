import { describe, it, expect } from "vitest";
import { normalizeCnJobs, expandCnQueries } from "./normalize";
import type { RawCnJob } from "./types";

describe("expandCnQueries", () => {
  it("strips trailing '开发工程师' to the base term", () => {
    expect(expandCnQueries(["全栈开发工程师"])).toEqual(
      expect.arrayContaining(["全栈开发工程师", "全栈"]),
    );
  });

  it("strips trailing '工程师'", () => {
    expect(expandCnQueries(["算法工程师"])).toEqual(
      expect.arrayContaining(["算法工程师", "算法"]),
    );
  });

  it("leaves pure-English queries untouched", () => {
    expect(expandCnQueries(["Software Engineer"])).toEqual(["Software Engineer"]);
  });

  it("drops empty and whitespace-only entries", () => {
    expect(expandCnQueries(["", "  ", "前端"])).toEqual(["前端"]);
  });

  it("preserves non-matching Chinese queries as-is", () => {
    expect(expandCnQueries(["产品经理"])).toEqual(["产品经理"]);
  });

  it("strips longest matching suffix first", () => {
    // "开发工程师" should win over "工程师" — we should not also add "算法开发".
    const out = expandCnQueries(["算法开发工程师"]);
    expect(out).toContain("算法开发工程师");
    expect(out).toContain("算法");
    expect(out).not.toContain("算法开发工程");
  });
});

function makeRaw(partial: Partial<RawCnJob>): RawCnJob {
  return {
    jobUrl: "https://example.com/job/1",
    title: "Frontend Engineer",
    company: null,
    location: null,
    jobType: null,
    jobLevel: null,
    description: null,
    publishedAt: null,
    source: "v2ex",
    ...partial,
  };
}

describe("normalizeCnJobs", () => {
  it("canonicalizes URLs and dedups cross-source", () => {
    const rows = normalizeCnJobs([
      makeRaw({
        jobUrl: "https://example.com/job/1?utm_source=v2ex",
        source: "v2ex",
      }),
      makeRaw({
        jobUrl: "https://example.com/job/1?utm_campaign=foo",
        source: "github",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].jobUrl).toBe("https://example.com/job/1");
  });

  it("drops rows with missing url or title", () => {
    const rows = normalizeCnJobs([
      makeRaw({ jobUrl: "" }),
      makeRaw({ title: "  " }),
      makeRaw({ jobUrl: "https://example.com/ok", title: "valid" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("valid");
  });

  it("tightens oversized fields", () => {
    const long = "x".repeat(500);
    const desc = "y".repeat(20000);
    const [row] = normalizeCnJobs([
      makeRaw({ title: long, description: desc }),
    ]);
    expect(row.title.length).toBe(200);
    expect(row.description?.length).toBe(8000);
  });

  it("keyword include filter requires at least one match", () => {
    const input = [
      makeRaw({
        jobUrl: "https://example.com/1",
        title: "前端工程师",
        description: "React experience",
      }),
      makeRaw({
        jobUrl: "https://example.com/2",
        title: "产品经理",
        description: "",
      }),
    ];
    const rows = normalizeCnJobs(input, { queries: ["前端"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].jobUrl).toBe("https://example.com/1");
  });

  it("keyword include match works case-insensitively on English", () => {
    const rows = normalizeCnJobs(
      [makeRaw({ title: "Backend Engineer", description: "python" })],
      { queries: ["Python"] },
    );
    expect(rows).toHaveLength(1);
  });

  it("empty queries disables include filter", () => {
    const rows = normalizeCnJobs([makeRaw({ title: "anything" })], {
      queries: [],
    });
    expect(rows).toHaveLength(1);
  });

  it("falls back to all rows when keyword filter matches zero (thin-day safety net)", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({ jobUrl: "https://example.com/a", title: "产品经理" }),
        makeRaw({ jobUrl: "https://example.com/b", title: "运营专员" }),
      ],
      { queries: ["大模型工程师"] },
    );
    // Neither row matches the query, but the pool is non-empty → return all.
    expect(rows).toHaveLength(2);
  });

  it("soft fallback still respects excludeKeywords", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({ jobUrl: "https://example.com/a", title: "实习运营" }),
        makeRaw({ jobUrl: "https://example.com/b", title: "产品经理" }),
      ],
      { queries: ["大模型"], excludeKeywords: ["实习"] },
    );
    // Strict = 0 → fallback to relaxed, but 实习 row is still excluded.
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("产品经理");
  });

  it("excludeKeywords drop on any hit", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({
          jobUrl: "https://example.com/1",
          title: "实习前端",
          description: "",
        }),
        makeRaw({
          jobUrl: "https://example.com/2",
          title: "高级前端",
          description: "",
        }),
      ],
      { excludeKeywords: ["实习"] },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("高级前端");
  });

  it("excludeKeywords checks company field too", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({
          jobUrl: "https://example.com/3",
          title: "Engineer",
          company: "外包公司 XYZ",
        }),
      ],
      { excludeKeywords: ["外包"] },
    );
    expect(rows).toEqual([]);
  });

  it("preserves source tag", () => {
    const rows = normalizeCnJobs([
      makeRaw({ jobUrl: "https://example.com/v", source: "v2ex" }),
      makeRaw({ jobUrl: "https://example.com/g", source: "github" }),
      makeRaw({ jobUrl: "https://example.com/r", source: "rsshub" }),
    ]);
    expect(rows.map((r) => r.source).sort()).toEqual([
      "github",
      "rsshub",
      "v2ex",
    ]);
  });

  it("always emits market='CN'", () => {
    const rows = normalizeCnJobs([makeRaw({})]);
    expect(rows[0].market).toBe("CN");
  });
});
