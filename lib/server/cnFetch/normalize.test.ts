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
    source: "nowcoder",
    ...partial,
  };
}

describe("normalizeCnJobs", () => {
  it("canonicalizes URLs and dedups duplicates", () => {
    const rows = normalizeCnJobs([
      makeRaw({
        jobUrl: "https://example.com/job/1?utm_source=nowcoder",
        source: "nowcoder",
      }),
      makeRaw({
        jobUrl: "https://example.com/job/1?utm_campaign=foo",
        source: "nowcoder",
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

  it("keeps only title-relevant rows when queries are present", () => {
    const input = [
      makeRaw({
        jobUrl: "https://example.com/2",
        title: "产品经理",
        description: "",
      }),
      makeRaw({
        jobUrl: "https://example.com/1",
        title: "前端工程师",
        description: "React experience",
      }),
    ];
    const rows = normalizeCnJobs(input, { queries: ["前端"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].jobUrl).toBe("https://example.com/1");
  });

  it("hard-filters by location when provided", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({ jobUrl: "https://example.com/a", title: "A", location: "北京 · 上海" }),
        makeRaw({ jobUrl: "https://example.com/b", title: "B", location: "深圳" }),
      ],
      { locations: ["上海"] },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].location).toBe("北京 · 上海");
  });

  it("does not count a description-only keyword hit as role relevance", () => {
    const rows = normalizeCnJobs(
      [makeRaw({ title: "Backend Engineer", description: "python" })],
      { queries: ["Python"] },
    );
    expect(rows).toHaveLength(0);
  });

  it("empty queries disables include filter", () => {
    const rows = normalizeCnJobs([makeRaw({ title: "anything" })], {
      queries: [],
    });
    expect(rows).toHaveLength(1);
  });

  it("returns no rows instead of unrelated fallback jobs when nothing matches", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({ jobUrl: "https://example.com/a", title: "产品经理" }),
        makeRaw({ jobUrl: "https://example.com/b", title: "运营专员" }),
      ],
      { queries: ["大模型工程师"] },
    );
    expect(rows).toHaveLength(0);
  });

  it("never revives irrelevant rows after exclusions", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({ jobUrl: "https://example.com/a", title: "实习运营" }),
        makeRaw({ jobUrl: "https://example.com/b", title: "产品经理" }),
      ],
      { queries: ["大模型"], excludeKeywords: ["实习"] },
    );
    expect(rows).toHaveLength(0);
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
      makeRaw({ jobUrl: "https://example.com/a", source: "nowcoder" }),
      makeRaw({ jobUrl: "https://example.com/b", source: "nowcoder" }),
    ]);
    expect(rows.every((r) => r.source === "nowcoder")).toBe(true);
  });

  it("always emits market='CN'", () => {
    const rows = normalizeCnJobs([makeRaw({})]);
    expect(rows[0].market).toBe("CN");
  });

  it("uses word boundaries for short English role terms", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({
          jobUrl: "https://example.com/go",
          title: "Go Engineer",
        }),
        makeRaw({
          jobUrl: "https://example.com/google",
          title: "Google Ads Specialist",
        }),
      ],
      { queries: ["Go"] },
    );

    expect(rows.map((row) => row.title)).toEqual(["Go Engineer"]);
  });

  it("matches reordered role variants without confusing Java and JavaScript", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({
          jobUrl: "https://example.com/java",
          title: "Senior Java Backend Engineer",
        }),
        makeRaw({
          jobUrl: "https://example.com/javascript",
          title: "Senior JavaScript Backend Engineer",
        }),
      ],
      { queries: ["Java Developer"] },
    );

    expect(rows.map((row) => row.title)).toEqual([
      "Senior Java Backend Engineer",
    ]);
  });

  it("matches mixed CJK/ASCII role variants with ASCII boundaries", () => {
    const rows = normalizeCnJobs(
      [
        makeRaw({
          jobUrl: "https://example.com/java-cn",
          title: "高级Java后端开发工程师",
        }),
        makeRaw({
          jobUrl: "https://example.com/javascript-cn",
          title: "高级JavaScript后端开发工程师",
        }),
      ],
      { queries: ["Java开发工程师"] },
    );

    expect(rows.map((row) => row.title)).toEqual([
      "高级Java后端开发工程师",
    ]);
  });

  it("preserves a valid upstream publication timestamp", () => {
    const rows = normalizeCnJobs([
      makeRaw({ publishedAt: "2026-07-19T10:00:00.000Z" }),
    ]);

    expect(rows[0].listingDate).toBe("2026-07-19T10:00:00.000Z");
  });
});
