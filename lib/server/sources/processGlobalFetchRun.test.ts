import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  importJobs: vi.fn(),
  runSourceFetch: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { fetchRun: { findMany: store.findMany, update: store.update } },
}));
vi.mock("@/lib/server/jobs/jobImportService", () => ({
  importJobsForUser: store.importJobs,
}));
vi.mock("./runSourceFetch", () => ({ runSourceFetch: store.runSourceFetch }));

import { processQueuedGlobalRuns } from "./processGlobalFetchRun";

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

describe("processQueuedGlobalRuns", () => {
  it("imports fetched jobs and marks the run succeeded", async () => {
    store.findMany.mockResolvedValue([
      { id: "run-1", userId: "user-1", queries: { sources: ["remoteok"] } },
    ]);
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
    });
    store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });

    await processQueuedGlobalRuns();

    expect(store.importJobs).toHaveBeenCalledWith({
      userId: "user-1",
      items: [
        expect.objectContaining({
          jobUrl: "https://remoteok.com/remote-jobs/1",
          market: "GLOBAL",
          source: "remoteok",
        }),
      ],
    });
    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { status: "SUCCEEDED", importedCount: 1, error: null },
    });
  });

  it("marks the run failed when every source failed", async () => {
    store.findMany.mockResolvedValue([
      { id: "run-2", userId: "user-1", queries: { sources: ["remoteok"] } },
    ]);
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        { source: "remoteok", ok: false, raw: 0, error: "HTTP 503" },
      ],
    });

    await processQueuedGlobalRuns();

    expect(store.importJobs).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-2" },
      data: {
        status: "FAILED",
        importedCount: 0,
        error: "all sources failed: remoteok: HTTP 503",
      },
    });
  });

  it("succeeds with zero imports when a healthy source returns nothing", async () => {
    store.findMany.mockResolvedValue([
      { id: "run-3", userId: "user-1", queries: { sources: ["remoteok"] } },
    ]);
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: true, raw: 0 }],
    });

    await processQueuedGlobalRuns();

    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-3" },
      data: { status: "SUCCEEDED", importedCount: 0, error: null },
    });
  });

  it("still succeeds when only some sources failed", async () => {
    store.findMany.mockResolvedValue([
      { id: "run-4", userId: "user-1", queries: { sources: ["remoteok", "jobicy"] } },
    ]);
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [
        { source: "remoteok", ok: true, raw: 1 },
        { source: "jobicy", ok: false, raw: 0, error: "timeout" },
      ],
    });
    store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });

    await processQueuedGlobalRuns();

    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-4" },
      data: { status: "SUCCEEDED", importedCount: 1, error: null },
    });
  });

  it("falls back to every registered source when none are specified", async () => {
    store.findMany.mockResolvedValue([
      { id: "run-5", userId: "user-1", queries: {} },
    ]);
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await processQueuedGlobalRuns();

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "remotive", "jobicy"],
    });
  });

  it("drops an unknown source id rather than passing it through", async () => {
    store.findMany.mockResolvedValue([
      {
        id: "run-6",
        userId: "user-1",
        queries: { sources: ["remoteok", "not-a-source"] },
      },
    ]);
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await processQueuedGlobalRuns();

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok"],
    });
  });

  it("isolates a thrown run so later runs still process", async () => {
    store.findMany.mockResolvedValue([
      { id: "run-7", userId: "user-1", queries: { sources: ["remoteok"] } },
      { id: "run-8", userId: "user-2", queries: { sources: ["remoteok"] } },
    ]);
    store.runSourceFetch
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ jobs: [], diagnostics: [] });

    await processQueuedGlobalRuns();

    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-7" },
      data: { status: "FAILED", importedCount: 0, error: "boom" },
    });
    expect(store.update).toHaveBeenCalledWith({
      where: { id: "run-8" },
      data: { status: "SUCCEEDED", importedCount: 0, error: null },
    });
  });
});
