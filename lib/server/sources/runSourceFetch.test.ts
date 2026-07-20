import { describe, expect, it } from "vitest";
import { runSourceFetch } from "./runSourceFetch";
import { ALL_SOURCE_IDS, isKnownSourceId } from "./registry";
import type { RawSourceJob, SourceAdapter } from "./types";

function job(
  overrides: Partial<RawSourceJob> & { jobUrl: string },
): RawSourceJob {
  return {
    title: "AI Engineer",
    company: "Acme",
    location: null,
    jobType: null,
    jobLevel: null,
    description: null,
    salary: null,
    workArrangement: "Remote",
    listingDate: null,
    source: "stub",
    ...overrides,
  };
}

function stubAdapter(id: string, jobs: RawSourceJob[]): SourceAdapter {
  return { id, allowedHosts: ["example.com"], fetch: async () => jobs };
}

function throwingAdapter(id: string, message: string): SourceAdapter {
  return {
    id,
    allowedHosts: ["example.com"],
    fetch: async () => {
      throw new Error(message);
    },
  };
}

describe("registry", () => {
  it("registers the three launch sources", () => {
    expect(ALL_SOURCE_IDS).toEqual(["remoteok", "remotive", "jobicy"]);
  });

  it("rejects an unknown source id", () => {
    expect(isKnownSourceId("remoteok")).toBe(true);
    expect(isKnownSourceId("not-a-source")).toBe(false);
  });
});

describe("runSourceFetch", () => {
  it("merges jobs from every requested source", async () => {
    const result = await runSourceFetch({
      sources: ["a", "b"],
      adapters: [
        stubAdapter("a", [job({ jobUrl: "https://example.com/1" })]),
        stubAdapter("b", [job({ jobUrl: "https://example.com/2" })]),
      ],
    });

    expect(result.jobs.map((j) => j.jobUrl)).toEqual([
      "https://example.com/1",
      "https://example.com/2",
    ]);
  });

  it("keeps other sources when one throws", async () => {
    const result = await runSourceFetch({
      sources: ["ok", "bad"],
      adapters: [
        stubAdapter("ok", [job({ jobUrl: "https://example.com/1" })]),
        throwingAdapter("bad", "upstream 503"),
      ],
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      { source: "ok", ok: true, raw: 1 },
      { source: "bad", ok: false, raw: 0, error: "upstream 503" },
    ]);
  });

  it("dedupes identical urls across sources, keeping the first", async () => {
    const result = await runSourceFetch({
      sources: ["a", "b"],
      adapters: [
        stubAdapter("a", [
          job({ jobUrl: "https://example.com/1", company: "First" }),
        ]),
        stubAdapter("b", [
          job({ jobUrl: "https://example.com/1", company: "Second" }),
        ]),
      ],
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].company).toBe("First");
  });

  it("reports a source id with no registered adapter", async () => {
    const result = await runSourceFetch({
      sources: ["ghost"],
      adapters: [stubAdapter("a", [])],
    });

    expect(result.jobs).toEqual([]);
    expect(result.diagnostics).toEqual([
      { source: "ghost", ok: false, raw: 0, error: "unknown_source" },
    ]);
  });

  it("returns empty when no sources are requested", async () => {
    const result = await runSourceFetch({ sources: [], adapters: [] });

    expect(result.jobs).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
