import { beforeEach, describe, it, expect, vi } from "vitest";

const safeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/net/safeFetch", () => ({
  safeOutboundFetch: safeFetchMock,
}));

import {
  extractInitialState,
  collectJobItems,
  collectCompanyNames,
  mapNowcoderJob,
  parseNowcoderHtml,
  fetchNowcoderJobs,
} from "./nowcoder";

// Build SSR HTML the way Nowcoder embeds it: window.__INITIAL_STATE__={...}.
function htmlWithState(state: unknown): string {
  return `<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script></body></html>`;
}

const STATE = {
  store: {
    jobList: [
      {
        data: {
          id: 111,
          jobName: "后端工程师",
          companyId: 665,
          jobCity: "北京,上海",
          ext: JSON.stringify({ infos: "职责A", requirements: "要求B" }),
          recruitType: 3,
        },
      },
      {
        data: {
          id: 222,
          jobName: "前端实习生",
          companyId: 900,
          jobCityList: ["深圳"],
          recruitType: 1,
        },
      },
    ],
    boss: { identity: [{ companyId: 665, companyName: "字节跳动" }] },
  },
};

describe("extractInitialState", () => {
  it("extracts the embedded JSON object", () => {
    const state = extractInitialState(htmlWithState({ a: 1, nested: { b: "}" } }));
    expect(state).toEqual({ a: 1, nested: { b: "}" } });
  });
  it("returns null when the marker is absent", () => {
    expect(extractInitialState("<html>no state</html>")).toBeNull();
  });
});

describe("collectJobItems / collectCompanyNames", () => {
  it("collects job rows by data.id + data.jobName", () => {
    const items = collectJobItems(STATE);
    expect(items.map((d) => d.id)).toEqual([111, 222]);
  });
  it("builds a companyId -> name map", () => {
    const map = collectCompanyNames(STATE);
    expect(map.get(665)).toBe("字节跳动");
    expect(map.has(900)).toBe(false);
  });
});

describe("mapNowcoderJob", () => {
  const companies = collectCompanyNames(STATE);
  it("maps a full-time row with company + city + description", () => {
    const job = mapNowcoderJob(collectJobItems(STATE)[0], companies)!;
    expect(job).toMatchObject({
      jobUrl: "https://www.nowcoder.com/jobs/detail/111",
      title: "后端工程师",
      company: "字节跳动",
      location: "北京 · 上海",
      jobType: null,
      source: "nowcoder",
    });
    expect(job.description).toContain("职责A");
    expect(job.description).toContain("要求B");
  });
  it("maps an intern row, leaves company null when unknown", () => {
    const job = mapNowcoderJob(collectJobItems(STATE)[1], companies)!;
    expect(job).toMatchObject({
      jobUrl: "https://www.nowcoder.com/jobs/detail/222",
      title: "前端实习生",
      company: null,
      location: "深圳",
      jobType: "internship",
    });
  });
});

describe("parseNowcoderHtml", () => {
  it("parses SSR HTML into deduped jobs", () => {
    const jobs = parseNowcoderHtml(htmlWithState(STATE));
    expect(jobs).toHaveLength(2);
    expect(jobs[0].company).toBe("字节跳动");
  });
  it("returns [] when no state present", () => {
    expect(parseNowcoderHtml("<html>nothing</html>")).toEqual([]);
  });
});

describe("fetchNowcoderJobs", () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
  });

  it("uses the safe outbound gateway with an exact production host allowlist", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(htmlWithState(STATE), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const res = await fetchNowcoderJobs({
      centers: ["https://www.nowcoder.com/jobs/fulltime/center"],
      timeoutMs: 3_000,
    });

    expect(safeFetchMock).toHaveBeenCalledWith(
      "https://www.nowcoder.com/jobs/fulltime/center",
      expect.objectContaining({
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JoblitBot/1.0; +https://www.joblit.tech)",
          Accept: "text/html,application/xhtml+xml",
        },
      }),
      {
        allowedHosts: ["www.nowcoder.com"],
        allowSubdomains: false,
        maxRedirects: 0,
        maxResponseBytes: 4 * 1024 * 1024,
        timeoutMs: 3_000,
      },
    );
    expect(res.jobs).toHaveLength(2);
  });

  it("fetches + dedups across centers with an honest bot UA", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(htmlWithState(STATE), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const res = await fetchNowcoderJobs({ fetchImpl });
    // Two centers fetched; identical jobs deduped to 2.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const ua = fetchImpl.mock.calls[0][1].headers["User-Agent"];
    expect(ua).toMatch(/JoblitBot/);
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(res.source).toBe("nowcoder");
    expect(res.jobs).toHaveLength(2);
  });

  it("reports an error but stays ok when a center fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(htmlWithState(STATE), { status: 200, headers: { "Content-Type": "text/html" } }),
      )
      .mockResolvedValueOnce(new Response("nope", { status: 503 }));
    const res = await fetchNowcoderJobs({ fetchImpl });
    expect(res.jobs).toHaveLength(2);
    expect(res.error).toContain("503");
  });
});
