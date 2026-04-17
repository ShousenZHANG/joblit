import { describe, it, expect, vi } from "vitest";
import { fetchRsshubJobs, parseRssItems } from "./rsshub";

describe("parseRssItems", () => {
  it("parses RSS 2.0 items with CDATA", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title><![CDATA[FE Engineer at Acme]]></title>
        <link>https://a.example/1</link>
        <description><![CDATA[Build stuff.]]></description>
        <pubDate>Tue, 01 Jan 2024 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
    const rows = parseRssItems(xml);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "FE Engineer at Acme",
      jobUrl: "https://a.example/1",
      description: "Build stuff.",
      source: "rsshub",
    });
    expect(rows[0].publishedAt).toMatch(/^2024-/);
  });

  it("parses plain (non-CDATA) tags", () => {
    const xml = `<rss><item><title>Role</title><link>https://x.example/2</link></item></rss>`;
    const rows = parseRssItems(xml);
    expect(rows[0].title).toBe("Role");
  });

  it("drops items missing title or link", () => {
    const xml = `<rss>
      <item><title>no link</title></item>
      <item><link>https://x.example/3</link></item>
    </rss>`;
    expect(parseRssItems(xml)).toEqual([]);
  });
});

describe("fetchRsshubJobs", () => {
  it("silent no-op when RSSHUB_URL is unset", async () => {
    const result = await fetchRsshubJobs({ baseUrl: undefined });
    expect(result.ok).toBe(true);
    expect(result.jobs).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("fetches each configured route and dedups", async () => {
    const xml1 = `<rss><item><title>A</title><link>https://x.example/4</link></item></rss>`;
    const xml2 = `<rss><item><title>B</title><link>https://x.example/4</link></item></rss>`; // dup URL
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => xml1 } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => xml2 } as Response);
    const result = await fetchRsshubJobs({
      baseUrl: "https://rsshub.test",
      routes: ["/a", "/b"],
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(1);
  });

  it("all routes fail => ok=false and jobs empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    const result = await fetchRsshubJobs({
      baseUrl: "https://rsshub.test",
      routes: ["/a"],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
  });
});
