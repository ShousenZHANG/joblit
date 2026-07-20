import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  update: vi.fn(),
  importJobs: vi.fn(),
  runSourceFetch: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { fetchRun: { update: store.update } },
}));
vi.mock("@/lib/server/jobs/jobImportService", () => ({
  importJobsForUser: store.importJobs,
}));
vi.mock("./runSourceFetch", () => ({ runSourceFetch: store.runSourceFetch }));

import { processGlobalFetchRun } from "./processGlobalFetchRun";

function sourceJob(jobUrl: string) {
  return {
    jobUrl,
    title: "AI Engineer",
    company: "Acme",
    location: null,
    jobType: null,
    jobLevel: null,
    description: null,
    salary: null,
    workArrangement: "Remote",
    listingDate: null,
    source: "remoteok",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.update.mockResolvedValue({});
});

describe("processGlobalFetchRun", () => {
  it("reports discovered and imported counts to the caller", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [
        sourceJob("https://remoteok.com/remote-jobs/1"),
        sourceJob("https://remoteok.com/remote-jobs/2"),
      ],
      diagnostics: [{ source: "remoteok", ok: true, raw: 2 }],
    });
    // One row was already known, so the importer keeps only the other.
    store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: ["remoteok"] },
    });

    expect(result).toEqual({ discovered: 2, imported: 1 });
  });

  it("returns the error it wrote to the run when every source failed", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: false, raw: 0, error: "HTTP 503" }],
    });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: ["remoteok"] },
    });

    expect(result).toEqual({
      discovered: 0,
      imported: 0,
      error: "all sources failed: remoteok: HTTP 503",
    });
  });

  it("falls back to every registered source when none are specified", async () => {
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await processGlobalFetchRun("user-1", { id: "run-1", queries: {} });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "remotive", "jobicy"],
    });
  });

  it("drops an unknown source id rather than passing it through", async () => {
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: ["remoteok", "not-a-source"] },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok"],
    });
  });

  it("succeeds with zero imports when a healthy source returns nothing", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: true, raw: 0 }],
    });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: ["remoteok"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0 });
    expect(store.importJobs).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { status: "SUCCEEDED", importedCount: 0, error: null },
    });
  });

  it("still succeeds when only some sources failed", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [
        { source: "remoteok", ok: true, raw: 1 },
        { source: "jobicy", ok: false, raw: 0, error: "timeout" },
      ],
    });
    store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: ["remoteok", "jobicy"] },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
  });

  it("surfaces a thrown fetch as an error result rather than rejecting", async () => {
    store.runSourceFetch.mockRejectedValue(new Error("boom"));

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: {},
    });

    expect(result).toEqual({ discovered: 0, imported: 0, error: "boom" });
    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { status: "FAILED", importedCount: 0, error: "boom" },
    });
  });
});
