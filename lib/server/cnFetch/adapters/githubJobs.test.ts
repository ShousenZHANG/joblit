import { describe, it, expect, vi } from "vitest";
import { fetchGithubJobs, parseJobsMarkdown } from "./githubJobs";

describe("parseJobsMarkdown", () => {
  it("parses pipe tables", () => {
    const md = [
      "| Company | Role | City | Link |",
      "| --- | --- | --- | --- |",
      "| Acme | Frontend Engineer | Shanghai | [Apply](https://a.example/1) |",
      "| Beta | Backend | Beijing | https://b.example/2 |",
    ].join("\n");
    const rows = parseJobsMarkdown(md);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      company: "Acme",
      title: "Frontend Engineer",
      location: "Shanghai",
      jobUrl: "https://a.example/1",
      source: "github",
    });
    expect(rows[1].jobUrl).toBe("https://b.example/2");
  });

  it("parses bullet list with 'at Company'", () => {
    const md = [
      "- [Senior Engineer at Acme](https://a.example/3) — Shanghai",
      "- [Backend @ Beta](https://b.example/4) – Remote",
    ].join("\n");
    const rows = parseJobsMarkdown(md);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Senior Engineer",
      company: "Acme",
      location: "Shanghai",
    });
    expect(rows[1]).toMatchObject({
      title: "Backend",
      company: "Beta",
      location: "Remote",
    });
  });

  it("skips alignment rows and header labels", () => {
    const md = [
      "| 公司 | 岗位 | 城市 |",
      "| :--- | :--- | :--- |",
      "| Acme | Role | Beijing | [link](https://x.example/5) |",
    ].join("\n");
    const rows = parseJobsMarkdown(md);
    expect(rows).toHaveLength(1);
  });

  it("dedups repeated URLs", () => {
    const md = [
      "- [A](https://x.example/6) — BJ",
      "- [B](https://x.example/6) — SH",
    ].join("\n");
    const rows = parseJobsMarkdown(md);
    expect(rows).toHaveLength(1);
  });

  it("returns empty on junk input", () => {
    expect(parseJobsMarkdown("")).toEqual([]);
    expect(parseJobsMarkdown("no links here, just prose.")).toEqual([]);
  });
});

describe("fetchGithubJobs", () => {
  it("fetches, parses, and dedups across repos", async () => {
    const mdA = [
      "- [Role A at Acme](https://a.example/7) — SH",
    ].join("\n");
    const mdB = [
      "- [Role B at Beta](https://b.example/8) — BJ",
      "- [Role A at Acme](https://a.example/7) — SH",
    ].join("\n");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => mdA } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => mdB } as Response);
    const result = await fetchGithubJobs({
      fetchImpl,
      repos: ["owner/a", "owner/b"],
    });
    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.jobUrl).sort()).toEqual([
      "https://a.example/7",
      "https://b.example/8",
    ]);
  });

  it("tries main after master when master 404s", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response) // master
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "- [X at Y](https://z.example/9) — SH",
      } as Response); // main
    const result = await fetchGithubJobs({ fetchImpl, repos: ["x/y"] });
    expect(result.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("marks ok=false only when every repo fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false } as Response);
    const result = await fetchGithubJobs({
      fetchImpl,
      repos: ["a/1", "a/2"],
    });
    expect(result.ok).toBe(false);
    expect(result.jobs).toEqual([]);
    expect(result.error).toContain("a/1_404");
  });

  it("stays ok=true when at least one repo succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response) // repo1/master
      .mockResolvedValueOnce({ ok: false } as Response) // repo1/main
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "- [A at B](https://c.example/1) — X",
      } as Response); // repo2/master
    const result = await fetchGithubJobs({
      fetchImpl,
      repos: ["bad/repo", "good/repo"],
    });
    expect(result.ok).toBe(true);
    expect(result.jobs).toHaveLength(1);
  });
});
