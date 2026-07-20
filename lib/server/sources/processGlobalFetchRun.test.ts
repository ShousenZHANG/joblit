import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  executeRawLock: vi.fn(),
  importJobs: vi.fn(),
  runSourceFetch: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: async (
      action: (tx: {
        fetchRun: {
          findFirst: typeof store.findFirst;
          updateMany: typeof store.updateMany;
        };
        $executeRaw: typeof store.executeRawLock;
      }) => Promise<unknown>,
    ) =>
      action({
        fetchRun: {
          findFirst: store.findFirst,
          updateMany: store.updateMany,
        },
        $executeRaw: store.executeRawLock,
      }),
  },
}));
vi.mock("@/lib/server/jobs/jobImportService", () => ({
  importJobsForUser: store.importJobs,
}));
vi.mock("./runSourceFetch", () => ({ runSourceFetch: store.runSourceFetch }));

import { processGlobalFetchRun } from "./processGlobalFetchRun";
import type { RawSourceJob } from "./types";

function sourceJob(jobUrl: string): RawSourceJob {
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
  store.findFirst.mockResolvedValue({ id: "run-1" });
  store.updateMany.mockResolvedValue({ count: 1 });
  store.executeRawLock.mockResolvedValue(1);
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
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
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
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    expect(result).toEqual({
      discovered: 0,
      imported: 0,
      error: "all sources failed: remoteok: HTTP 503",
    });
  });

  it("falls back to every registered source when none are specified", async () => {
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["AI Engineer"] },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "remotive", "jobicy"],
    });
  });

  it("drops an unknown source id rather than passing it through", async () => {
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: {
        sources: ["remoteok", "not-a-source"],
        queries: ["AI Engineer"],
      },
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
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0 });
    expect(store.importJobs).not.toHaveBeenCalled();
    expect(store.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", userId: "user-1", status: "RUNNING" },
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
      queries: {
        sources: ["remoteok", "jobicy"],
        queries: ["AI Engineer"],
      },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
  });

  it("enforces persisted freshness and description exclusions before import", async () => {
    const recent = sourceJob("https://remoteok.com/remote-jobs/recent");
    recent.listingDate = "2026-07-20T00:00:00.000Z";
    const old = sourceJob("https://remoteok.com/remote-jobs/old");
    old.listingDate = "2020-01-01T00:00:00.000Z";
    const gated = sourceJob("https://remoteok.com/remote-jobs/gated");
    gated.description = "Candidates must have 6+ years of professional experience.";
    store.runSourceFetch.mockResolvedValue({
      jobs: [recent, old, gated],
      diagnostics: [{ source: "remoteok", ok: true, raw: 3 }],
    });
    store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: {
        sources: ["remoteok"],
        queries: ["AI Engineer"],
        hoursOld: 24 * 30,
        applyExcludes: true,
        excludeDescriptionRules: ["experience_requirement_4_plus"],
      },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
    expect(store.importJobs).toHaveBeenCalledWith({
      userId: "user-1",
      items: [expect.objectContaining({ jobUrl: recent.jobUrl, market: "GLOBAL" })],
    });
  });

  it("surfaces a thrown fetch as an error result rather than rejecting", async () => {
    store.runSourceFetch.mockRejectedValue(new Error("boom"));

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0, error: "boom" });
    expect(store.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", userId: "user-1", status: "RUNNING" },
      data: { status: "FAILED", importedCount: 0, error: "boom" },
    });
  });

  it("does not import when cancellation wins before the commit phase", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
    });
    store.findFirst.mockResolvedValue(null);

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0, cancelled: true });
    expect(store.importJobs).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });
});
