import { describe, it, expect, vi } from "vitest";
import { fetchV2exJobs, parseV2exTitle } from "./v2exJobs";

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("parseV2exTitle", () => {
  it("extracts company + location from bracketed title", () => {
    const r = parseV2exTitle("[字节跳动][前端工程师][上海]");
    expect(r.company).toBe("字节跳动");
    expect(r.location).toBe("上海");
    expect(r.title).toBe("前端工程师");
  });

  it("handles Chinese 【】 brackets", () => {
    const r = parseV2exTitle("【字节跳动招聘】前端工程师");
    expect(r.company).toBe("字节跳动招聘");
    expect(r.title).toBe("前端工程师");
  });

  it("falls back to raw title when no brackets", () => {
    const r = parseV2exTitle("急招 Go 后端 5-8 年");
    expect(r.title).toBe("急招 Go 后端 5-8 年");
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
  });

  it("returns empty safely", () => {
    const r = parseV2exTitle("");
    expect(r.title).toBe("");
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
  });
});

describe("fetchV2exJobs", () => {
  it("maps topics to RawCnJob[] on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse([
        {
          id: 1,
          title: "[Acme][Frontend Engineer][Shanghai]",
          url: "https://www.v2ex.com/t/1",
          content: "We hire FE.",
          created: 1_700_000_000,
          member: { username: "hr-acme" },
        },
      ]),
    );
    const result = await fetchV2exJobs({ fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("v2ex");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      jobUrl: "https://www.v2ex.com/t/1",
      title: "Frontend Engineer",
      company: "Acme",
      location: "Shanghai",
      description: "We hire FE.",
      source: "v2ex",
    });
    expect(result.jobs[0].publishedAt).toMatch(/^2023-/);
  });

  it("returns ok=false with error code on non-200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({}, 503));
    const result = await fetchV2exJobs({ fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("v2ex_503");
    expect(result.jobs).toEqual([]);
  });

  it("handles malformed JSON shape gracefully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({ not: "array" }));
    const result = await fetchV2exJobs({ fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("v2ex_bad_shape");
  });

  it("catches thrown fetch errors (network failure)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ENETDOWN"));
    const result = await fetchV2exJobs({ fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ENETDOWN");
  });

  it("falls back to username for company when brackets absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse([
        {
          id: 2,
          title: "招前端",
          url: "https://www.v2ex.com/t/2",
          member: { username: "alice" },
        },
      ]),
    );
    const result = await fetchV2exJobs({ fetchImpl });
    expect(result.jobs[0].company).toBe("alice");
  });

  it("drops topics missing url or title", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse([
        { id: 3, title: "no url" },
        { id: 4, url: "https://www.v2ex.com/t/4", title: "ok" },
      ]),
    );
    const result = await fetchV2exJobs({ fetchImpl });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobUrl).toBe("https://www.v2ex.com/t/4");
  });
});
