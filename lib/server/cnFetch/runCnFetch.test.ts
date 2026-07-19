import { describe, it, expect, vi } from "vitest";
import { runCnFetch } from "./runCnFetch";
import type { AdapterResult, RawCnJob } from "./types";

function job(i: number, over: Partial<RawCnJob> = {}): RawCnJob {
  return {
    jobUrl: `https://nowcoder.example/job/${i}`,
    title: `Role ${i}`,
    company: null,
    location: null,
    jobType: null,
    jobLevel: null,
    description: null,
    publishedAt: null,
    source: "nowcoder",
    ...over,
  };
}

function ok(count: number): AdapterResult {
  return {
    source: "nowcoder",
    ok: true,
    jobs: Array.from({ length: count }, (_, i) => job(i)),
  };
}

function fail(error: string): AdapterResult {
  return { source: "nowcoder", ok: false, jobs: [], error };
}

describe("runCnFetch", () => {
  it("returns jobs from the nowcoder source", async () => {
    const result = await runCnFetch({
      adapters: { nowcoder: vi.fn().mockResolvedValue(ok(3)) },
    });
    expect(result.jobs).toHaveLength(3);
    expect(result.diagnostics).toEqual([{ source: "nowcoder", ok: true, raw: 3 }]);
  });

  it("reports a failed source without throwing", async () => {
    const result = await runCnFetch({
      adapters: { nowcoder: vi.fn().mockResolvedValue(fail("nowcoder_503")) },
    });
    expect(result.jobs).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ ok: false, error: "nowcoder_503" });
  });

  it("catches an adapter throw and reports it", async () => {
    const result = await runCnFetch({
      adapters: { nowcoder: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    expect(result.jobs).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      source: "nowcoder",
      ok: false,
      error: "boom",
    });
  });

  it("keeps only title-relevant jobs when queries are supplied", async () => {
    const result = await runCnFetch({
      queries: ["前端"],
      adapters: {
        nowcoder: vi.fn().mockResolvedValue({
          source: "nowcoder",
          ok: true,
          jobs: [
            job(2, { jobUrl: "https://nowcoder.example/b", title: "产品经理" }),
            job(1, { jobUrl: "https://nowcoder.example/a", title: "前端工程师" }),
          ],
        }),
      },
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("前端工程师");
  });

  it("hard-filters by location when given", async () => {
    const result = await runCnFetch({
      locations: ["上海"],
      adapters: {
        nowcoder: vi.fn().mockResolvedValue({
          source: "nowcoder",
          ok: true,
          jobs: [
            job(1, { jobUrl: "https://nowcoder.example/a", title: "A", location: "北京 · 上海" }),
            job(2, { jobUrl: "https://nowcoder.example/b", title: "B", location: "深圳" }),
          ],
        }),
      },
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].location).toBe("北京 · 上海");
  });

  it("applies the excludeKeywords filter via normalize", async () => {
    const result = await runCnFetch({
      excludeKeywords: ["实习"],
      adapters: {
        nowcoder: vi.fn().mockResolvedValue({
          source: "nowcoder",
          ok: true,
          jobs: [
            job(1, { jobUrl: "https://nowcoder.example/a", title: "实习前端" }),
            job(2, { jobUrl: "https://nowcoder.example/b", title: "正式前端" }),
          ],
        }),
      },
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("正式前端");
  });

  it("defaults to the nowcoder source when sources omitted", async () => {
    const adapter = vi.fn().mockResolvedValue(ok(1));
    await runCnFetch({ adapters: { nowcoder: adapter } });
    expect(adapter).toHaveBeenCalledOnce();
  });
});
