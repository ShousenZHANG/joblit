import { describe, it, expect, vi } from "vitest";
import {
  isNowcoderUrl,
  parseNowcoderTitle,
  extractCnCity,
  enrichNowcoderJob,
  parseRssItems,
  fetchNowcoderJobs,
} from "./nowcoder";
import type { RawCnJob } from "../types";

function row(over: Partial<RawCnJob> = {}): RawCnJob {
  return {
    jobUrl: "https://www.nowcoder.com/jobs/detail/123",
    title: "字节跳动 | 后端开发工程师",
    company: null,
    location: null,
    jobType: null,
    jobLevel: null,
    description: "<div>岗位职责... 工作地点：上海 薪资 25k</div>",
    publishedAt: null,
    source: "nowcoder",
    ...over,
  };
}

describe("isNowcoderUrl", () => {
  it("matches nowcoder hosts", () => {
    expect(isNowcoderUrl("https://www.nowcoder.com/jobs/detail/1")).toBe(true);
    expect(isNowcoderUrl("https://nowcoder.com/x")).toBe(true);
  });
  it("rejects other hosts and junk", () => {
    expect(isNowcoderUrl("https://v2ex.com/t/1")).toBe(false);
    expect(isNowcoderUrl("not-a-url")).toBe(false);
    expect(isNowcoderUrl("https://nowcoder.com.evil.com/x")).toBe(false);
  });
});

describe("parseNowcoderTitle", () => {
  it("splits 'Company | Title' on a half-width bar", () => {
    expect(parseNowcoderTitle("字节跳动 | 后端开发工程师")).toEqual({
      company: "字节跳动",
      title: "后端开发工程师",
    });
  });
  it("splits on a full-width bar", () => {
    expect(parseNowcoderTitle("阿里巴巴｜前端工程师")).toEqual({
      company: "阿里巴巴",
      title: "前端工程师",
    });
  });
  it("falls back to the whole string when there is no bar", () => {
    expect(parseNowcoderTitle("后端开发工程师")).toEqual({
      company: null,
      title: "后端开发工程师",
    });
  });
});

describe("extractCnCity", () => {
  it("finds a city in the description", () => {
    expect(extractCnCity("工作地点：上海，全职")).toBe("上海");
    expect(extractCnCity("<p>深圳 · 社招</p>")).toBe("深圳");
  });
  it("returns null when no known city is present", () => {
    expect(extractCnCity("远程办公")).toBeNull();
    expect(extractCnCity(null)).toBeNull();
  });
});

describe("enrichNowcoderJob", () => {
  it("pulls company from the title and city from the description", () => {
    const out = enrichNowcoderJob(row());
    expect(out.company).toBe("字节跳动");
    expect(out.title).toBe("后端开发工程师");
    expect(out.location).toBe("上海");
  });
  it("does not overwrite a company/location already present", () => {
    const out = enrichNowcoderJob(row({ company: "已知公司", location: "北京" }));
    expect(out.company).toBe("已知公司");
    expect(out.location).toBe("北京");
  });
});

describe("parseRssItems", () => {
  const xml = `<rss><channel>
    <item>
      <title>腾讯 | 高级前端工程师</title>
      <link>https://www.nowcoder.com/jobs/detail/1</link>
      <description><![CDATA[<div>工作地点：深圳 · 社招</div>]]></description>
      <pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>美团 | 数据工程师</title>
      <link>https://www.nowcoder.com/jobs/detail/2</link>
      <description>北京岗位</description>
    </item>
  </channel></rss>`;

  it("parses + enriches each RSS item", () => {
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      jobUrl: "https://www.nowcoder.com/jobs/detail/1",
      company: "腾讯",
      title: "高级前端工程师",
      location: "深圳",
      source: "nowcoder",
    });
    expect(items[1]).toMatchObject({ company: "美团", title: "数据工程师", location: "北京" });
  });

  it("returns [] for empty input", () => {
    expect(parseRssItems("")).toEqual([]);
  });
});

describe("fetchNowcoderJobs", () => {
  it("is a silent no-op when RSSHUB_URL / baseUrl is unset", async () => {
    const res = await fetchNowcoderJobs({ baseUrl: undefined });
    expect(res).toEqual({ source: "nowcoder", ok: true, jobs: [] });
  });

  it("fetches + dedups across routes when a baseUrl is given", async () => {
    const xml = `<rss><channel><item>
      <title>腾讯 | 前端</title><link>https://www.nowcoder.com/jobs/detail/1</link>
      <description>深圳</description></item></channel></rss>`;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } }),
    );
    const res = await fetchNowcoderJobs({ baseUrl: "https://rss.example", fetchImpl });
    // Two default routes, same single job URL → deduped to 1.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.source).toBe("nowcoder");
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0].company).toBe("腾讯");
  });
});
