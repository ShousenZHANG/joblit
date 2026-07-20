import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  executeRawLock: vi.fn(),
  importJobs: vi.fn(),
  runSourceFetch: vi.fn(),
  loadAtsAdapters: vi.fn(),
  recoverAtsBoards: vi.fn(),
  persistHealth: vi.fn(),
  reconcileLiveness: vi.fn(),
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
vi.mock("./atsBoardStore", () => ({
  loadEnabledAtsBoardAdapters: store.loadAtsAdapters,
}));
vi.mock("./atsRediscoveryService", () => ({
  recoverAtsBoardsAfter404: store.recoverAtsBoards,
}));
vi.mock("./sourceHealthStore", () => ({
  persistSourceHealthDiagnostics: store.persistHealth,
}));
vi.mock("@/lib/server/jobs/sourceLivenessService", () => ({
  reconcileFetchedSourceJobLiveness: store.reconcileLiveness,
}));

import { processGlobalFetchRun } from "./processGlobalFetchRun";
import { MAX_GLOBAL_SOURCES_PER_RUN } from "./limits";
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
  store.loadAtsAdapters.mockResolvedValue({
    adapters: [],
    boards: [],
    issues: [],
  });
  store.recoverAtsBoards.mockResolvedValue({ recovered: [], errors: [] });
  store.persistHealth.mockResolvedValue(undefined);
  store.reconcileLiveness.mockResolvedValue(undefined);
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

  it("loads enabled DB-backed ATS adapters and persists source health", async () => {
    const adapter = {
      id: "ats:greenhouse:acme",
      allowedHosts: ["boards-api.greenhouse.io"],
      fetch: vi.fn(),
    };
    const board = {
      id: "ats:greenhouse:acme",
      provider: "greenhouse",
      boardToken: "acme",
      company: "Acme",
    };
    store.loadAtsAdapters.mockResolvedValue({
      adapters: [adapter],
      boards: [board],
      issues: [],
    });
    const diagnostics = [
      { source: "ats:greenhouse:acme", ok: true, raw: 1 },
    ];
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics });

    await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "ats:greenhouse:acme"],
      adapters: expect.arrayContaining([adapter]),
    });
    expect(store.persistHealth).toHaveBeenCalledWith(diagnostics);
    expect(store.recoverAtsBoards).toHaveBeenCalledWith({
      boards: [board],
      diagnostics,
    });
  });

  it("honors a new explicit source selection without appending every ATS board", async () => {
    const adapter = {
      id: "ats:greenhouse:acme",
      allowedHosts: ["boards-api.greenhouse.io"],
      fetch: vi.fn(),
    };
    store.loadAtsAdapters.mockResolvedValue({
      adapters: [adapter],
      boards: [],
      issues: [],
    });
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: true, raw: 0 }],
    });

    await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: {
        sources: ["remoteok"],
        sourceSelection: "explicit",
        queries: ["AI Engineer"],
      },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok"],
      adapters: expect.arrayContaining([adapter]),
    });
  });

  it("imports jobs recovered from a rotated ATS board in the same run", async () => {
    const adapter = {
      id: "ats:greenhouse:acme",
      allowedHosts: ["boards-api.greenhouse.io"],
      fetch: vi.fn(),
    };
    const board = {
      id: adapter.id,
      provider: "greenhouse",
      boardToken: "acme-old",
      company: "Acme",
      careersUrl: "https://careers.acme.example",
    };
    const recovered = {
      source: adapter.id,
      config: { ...board, boardToken: "acme-new" },
      jobs: [
        {
          ...sourceJob("https://boards.greenhouse.io/acme-new/jobs/123"),
          source: adapter.id,
        },
      ],
    };
    store.loadAtsAdapters.mockResolvedValue({
      adapters: [adapter],
      boards: [board],
      issues: [],
    });
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        { source: adapter.id, ok: false, raw: 0, error: "HTTP 404" },
      ],
    });
    store.recoverAtsBoards.mockResolvedValue({
      recovered: [recovered],
      errors: [],
    });
    store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { sources: [adapter.id], queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
    expect(store.persistHealth).toHaveBeenCalledWith([
      { source: adapter.id, ok: true, raw: 1 },
    ]);
    expect(store.importJobs).toHaveBeenCalledWith({
      userId: "user-1",
      items: [
        expect.objectContaining({
          jobUrl: recovered.jobs[0].jobUrl,
          market: "GLOBAL",
        }),
      ],
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

  it("fails before network I/O when a legacy run exceeds the serverless source budget", async () => {
    store.loadAtsAdapters.mockResolvedValue({
      adapters: Array.from(
        { length: MAX_GLOBAL_SOURCES_PER_RUN },
        (_, index) => ({
          id: `ats:greenhouse:company-${index}`,
          allowedHosts: ["boards-api.greenhouse.io"],
          fetch: vi.fn(),
        }),
      ),
      boards: [],
      issues: [],
    });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toMatchObject({
      discovered: 0,
      imported: 0,
      error: expect.stringContaining("source limit exceeded"),
    });
    expect(store.runSourceFetch).not.toHaveBeenCalled();
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
