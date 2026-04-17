import { describe, it, expect, vi } from "vitest";
import { runCnFetch } from "./runCnFetch";
import type { AdapterResult } from "./types";

function ok(source: AdapterResult["source"], count: number): AdapterResult {
  return {
    source,
    ok: true,
    jobs: Array.from({ length: count }, (_, i) => ({
      jobUrl: `https://${source}.example/job/${i}`,
      title: `Role ${i}`,
      company: null,
      location: null,
      jobType: null,
      jobLevel: null,
      description: null,
      publishedAt: null,
      source,
    })),
  };
}

function fail(source: AdapterResult["source"], error: string): AdapterResult {
  return { source, ok: false, jobs: [], error };
}

describe("runCnFetch", () => {
  it("merges jobs from all enabled sources", async () => {
    const result = await runCnFetch({
      sources: ["v2ex", "github"],
      adapters: {
        v2ex: vi.fn().mockResolvedValue(ok("v2ex", 3)),
        github: vi.fn().mockResolvedValue(ok("github", 2)),
      },
    });
    expect(result.jobs).toHaveLength(5);
    expect(result.diagnostics).toEqual([
      { source: "v2ex", ok: true, raw: 3 },
      { source: "github", ok: true, raw: 2 },
    ]);
  });

  it("keeps running when one source fails", async () => {
    const result = await runCnFetch({
      sources: ["v2ex", "github"],
      adapters: {
        v2ex: vi.fn().mockResolvedValue(fail("v2ex", "v2ex_503")),
        github: vi.fn().mockResolvedValue(ok("github", 2)),
      },
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({ ok: false, error: "v2ex_503" });
    expect(result.diagnostics[1]).toMatchObject({ ok: true, raw: 2 });
  });

  it("all sources fail => empty jobs + diagnostics preserved", async () => {
    const result = await runCnFetch({
      sources: ["v2ex", "github"],
      adapters: {
        v2ex: vi.fn().mockResolvedValue(fail("v2ex", "down")),
        github: vi.fn().mockResolvedValue(fail("github", "down")),
      },
    });
    expect(result.jobs).toEqual([]);
    expect(result.diagnostics.every((d) => !d.ok)).toBe(true);
  });

  it("adapter throw is caught and reported", async () => {
    const result = await runCnFetch({
      sources: ["v2ex"],
      adapters: {
        v2ex: vi.fn().mockRejectedValue(new Error("boom")),
      },
    });
    expect(result.jobs).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      source: "v2ex",
      ok: false,
      error: "boom",
    });
  });

  it("runs adapters in parallel (not sequential)", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const slow = vi.fn(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      return ok("v2ex", 1);
    });
    await runCnFetch({
      sources: ["v2ex", "github", "rsshub"],
      adapters: { v2ex: slow, github: slow, rsshub: slow },
    });
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });

  it("applies query filter via normalize", async () => {
    const result = await runCnFetch({
      sources: ["v2ex"],
      queries: ["前端"],
      adapters: {
        v2ex: vi.fn().mockResolvedValue({
          source: "v2ex",
          ok: true,
          jobs: [
            {
              jobUrl: "https://v2ex.example/1",
              title: "前端工程师",
              company: null,
              location: null,
              jobType: null,
              jobLevel: null,
              description: null,
              publishedAt: null,
              source: "v2ex" as const,
            },
            {
              jobUrl: "https://v2ex.example/2",
              title: "产品经理",
              company: null,
              location: null,
              jobType: null,
              jobLevel: null,
              description: null,
              publishedAt: null,
              source: "v2ex" as const,
            },
          ],
        }),
      },
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("前端工程师");
  });

  it("applies excludeKeywords filter via normalize", async () => {
    const result = await runCnFetch({
      sources: ["v2ex"],
      excludeKeywords: ["实习"],
      adapters: {
        v2ex: vi.fn().mockResolvedValue({
          source: "v2ex",
          ok: true,
          jobs: [
            {
              jobUrl: "https://v2ex.example/a",
              title: "实习前端",
              company: null,
              location: null,
              jobType: null,
              jobLevel: null,
              description: null,
              publishedAt: null,
              source: "v2ex" as const,
            },
            {
              jobUrl: "https://v2ex.example/b",
              title: "正式前端",
              company: null,
              location: null,
              jobType: null,
              jobLevel: null,
              description: null,
              publishedAt: null,
              source: "v2ex" as const,
            },
          ],
        }),
      },
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("正式前端");
  });

  it("defaults to v2ex + github when sources omitted", async () => {
    const v2exAdapter = vi.fn().mockResolvedValue(ok("v2ex", 1));
    const githubAdapter = vi.fn().mockResolvedValue(ok("github", 1));
    await runCnFetch({
      adapters: { v2ex: v2exAdapter, github: githubAdapter },
    });
    expect(v2exAdapter).toHaveBeenCalledOnce();
    expect(githubAdapter).toHaveBeenCalledOnce();
  });
});
