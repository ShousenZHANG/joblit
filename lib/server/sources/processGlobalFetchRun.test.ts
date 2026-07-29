import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  runSourceFetch: vi.fn(),
  loadAtsAdapters: vi.fn(),
  recoverAtsBoards: vi.fn(),
  persistHealth: vi.fn(),
  reconcileLiveness: vi.fn(),
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

import { discoverGlobalFetchRun } from "./processGlobalFetchRun";
import { MAX_GLOBAL_SOURCES_PER_RUN } from "./limits";
import type { RawSourceJob } from "./types";
import { buildGlobalFetchRunConfigV1 } from "@/lib/shared/schemas/fetchRunConfig";

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

function input(queries: unknown, userId = "user-1") {
  return { userId, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.loadAtsAdapters.mockResolvedValue({
    adapters: [],
    boards: [],
    issues: [],
  });
  store.recoverAtsBoards.mockResolvedValue({ recovered: [], errors: [] });
  store.persistHealth.mockResolvedValue(undefined);
  store.reconcileLiveness.mockResolvedValue(undefined);
});

describe("discoverGlobalFetchRun", () => {
  it("normalizes discoveries into a terminal plan and defers projections", async () => {
    const jobs = [
      sourceJob("https://remoteok.com/remote-jobs/1"),
      sourceJob("https://remoteok.com/remote-jobs/2"),
    ];
    const diagnostics = [{ source: "remoteok", ok: true, raw: 2 }];
    store.runSourceFetch.mockResolvedValue({ jobs, diagnostics });

    const result = await discoverGlobalFetchRun(
      input({ sources: ["remoteok"], queries: ["AI Engineer"] }),
    );

    expect(result).toMatchObject({
      kind: "commit",
      batchKey: "global-result-v1",
      discovered: 2,
      terminalOutcome: "SUCCEEDED",
      items: [
        expect.objectContaining({ jobUrl: jobs[0].jobUrl, market: "GLOBAL" }),
        expect.objectContaining({ jobUrl: jobs[1].jobUrl, market: "GLOBAL" }),
      ],
      postTerminal: expect.any(Function),
    });
    expect(store.persistHealth).not.toHaveBeenCalled();
    expect(store.reconcileLiveness).not.toHaveBeenCalled();

    await result.postTerminal?.();

    const observedAt = store.persistHealth.mock.calls[0]?.[1];
    expect(observedAt).toBeInstanceOf(Date);
    expect(store.persistHealth).toHaveBeenCalledWith(diagnostics, observedAt);
    expect(store.reconcileLiveness).toHaveBeenCalledWith(
      expect.objectContaining({ checkedAt: observedAt }),
    );
  });

  it("executes a historical source-only row without inventing a role filter", async () => {
    const accountant = {
      ...sourceJob("https://remoteok.com/remote-jobs/accountant"),
      title: "Commercial Accountant",
    };
    store.runSourceFetch.mockResolvedValue({
      jobs: [accountant],
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
    });

    const result = await discoverGlobalFetchRun(
      input({ sources: ["remoteok"] }),
    );

    expect(result).toMatchObject({
      kind: "commit",
      discovered: 1,
      items: [
        expect.objectContaining({
          title: "Commercial Accountant",
          market: "GLOBAL",
        }),
      ],
    });
  });

  it("fails closed when an explicit source-only ATS board is unavailable", async () => {
    const disabledSource = "ats:greenhouse:disabled";
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        {
          source: disabledSource,
          ok: false,
          raw: 0,
          error: "unknown_source",
        },
      ],
    });

    const result = await discoverGlobalFetchRun(
      input({ sources: [disabledSource] }),
    );

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: [disabledSource],
    });
    expect(result).toMatchObject({
      kind: "fail",
      error: `all sources failed: ${disabledSource}: unknown_source`,
      postTerminal: expect.any(Function),
    });
  });

  it("reports a healthy empty source as a successful empty commit", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: true, raw: 0 }],
    });

    const result = await discoverGlobalFetchRun(
      input({ sources: ["remoteok"], queries: ["AI Engineer"] }),
    );

    expect(result).toMatchObject({
      kind: "commit",
      items: [],
      discovered: 0,
      terminalOutcome: "SUCCEEDED",
    });
  });

  it("falls back to every registered source when none are specified", async () => {
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await discoverGlobalFetchRun(input({ queries: ["AI Engineer"] }));

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "remotive", "jobicy"],
    });
  });

  it("drops an unknown legacy source id rather than passing it through", async () => {
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    await discoverGlobalFetchRun(
      input({
        sources: ["remoteok", "not-a-source"],
        queries: ["AI Engineer"],
      }),
    );

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok"],
    });
  });

  it("loads DB-backed ATS adapters and publishes their diagnostics only from the hook", async () => {
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
    const diagnostics = [
      { source: "ats:greenhouse:acme", ok: true, raw: 1 },
    ];
    store.loadAtsAdapters.mockResolvedValue({
      adapters: [adapter],
      boards: [board],
      issues: [],
    });
    store.runSourceFetch.mockResolvedValue({ jobs: [], diagnostics });

    const result = await discoverGlobalFetchRun(
      input({ sources: ["remoteok"], queries: ["AI Engineer"] }),
    );

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "ats:greenhouse:acme"],
      adapters: expect.arrayContaining([adapter]),
    });
    expect(store.recoverAtsBoards).toHaveBeenCalledWith({
      boards: [board],
      diagnostics,
    });
    expect(store.persistHealth).not.toHaveBeenCalled();

    await result.postTerminal?.();

    expect(store.persistHealth).toHaveBeenCalledWith(
      diagnostics,
      expect.any(Date),
    );
  });

  it("executes a versioned all-source run from its creation-time snapshot", async () => {
    const persistedSource = "ats:greenhouse:persisted";
    const newlyEnabledAdapter = {
      id: "ats:greenhouse:new",
      allowedHosts: ["boards-api.greenhouse.io"],
      fetch: vi.fn(),
    };
    store.loadAtsAdapters.mockResolvedValue({
      adapters: [newlyEnabledAdapter],
      boards: [],
      issues: [],
    });
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        { source: "remoteok", ok: true, raw: 0 },
        {
          source: persistedSource,
          ok: false,
          raw: 0,
          error: "unknown_source",
        },
      ],
    });

    await discoverGlobalFetchRun(
      input(
        buildGlobalFetchRunConfigV1({
          title: "AI Engineer",
          baseQueries: ["AI Engineer"],
          queries: ["AI Engineer"],
          location: null,
          hoursOld: null,
          resultsWanted: null,
          smartExpand: false,
          includeFromQueries: true,
          applyExcludes: false,
          excludeTitleTerms: [],
          excludeDescriptionRules: [],
          sources: ["remoteok", persistedSource],
          sourceSelection: "all",
        }),
      ),
    );

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", persistedSource],
      adapters: expect.arrayContaining([newlyEnabledAdapter]),
    });
  });

  it("honors an explicit selection without appending enabled ATS boards", async () => {
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

    await discoverGlobalFetchRun(
      input({
        sources: ["remoteok"],
        sourceSelection: "explicit",
        queries: ["AI Engineer"],
      }),
    );

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok"],
      adapters: expect.arrayContaining([adapter]),
    });
  });

  it("keeps unavailable explicit sources and returns a partial commit plan", async () => {
    const disabledSource = "ats:greenhouse:disabled";
    const job = sourceJob("https://remoteok.com/remote-jobs/1");
    store.runSourceFetch.mockResolvedValue({
      jobs: [job],
      diagnostics: [
        { source: "remoteok", ok: true, raw: 1 },
        {
          source: disabledSource,
          ok: false,
          raw: 0,
          error: "unknown_source",
        },
      ],
    });

    const result = await discoverGlobalFetchRun(
      input({
        sources: ["remoteok", disabledSource],
        sourceSelection: "explicit",
        queries: ["AI Engineer"],
      }),
    );

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", disabledSource],
    });
    expect(result).toMatchObject({
      kind: "commit",
      discovered: 1,
      terminalOutcome: "PARTIAL",
      error: `${disabledSource}: unknown_source`,
      items: [expect.objectContaining({ jobUrl: job.jobUrl })],
    });
  });

  it("includes jobs recovered from a rotated ATS board in the same plan", async () => {
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

    const result = await discoverGlobalFetchRun(
      input({ sources: [adapter.id], queries: ["AI Engineer"] }),
    );

    expect(result).toMatchObject({
      kind: "commit",
      discovered: 1,
      items: [
        expect.objectContaining({
          jobUrl: recovered.jobs[0].jobUrl,
          market: "GLOBAL",
        }),
      ],
    });
    await result.postTerminal?.();
    expect(store.persistHealth).toHaveBeenCalledWith(
      [{ source: adapter.id, ok: true, raw: 1 }],
      expect.any(Date),
    );
  });

  it("enforces persisted freshness and description exclusions before commit", async () => {
    const recent = sourceJob("https://remoteok.com/remote-jobs/recent");
    recent.listingDate = "2026-07-20T00:00:00.000Z";
    const old = sourceJob("https://remoteok.com/remote-jobs/old");
    old.listingDate = "2020-01-01T00:00:00.000Z";
    const gated = sourceJob("https://remoteok.com/remote-jobs/gated");
    gated.description =
      "Candidates must have 6+ years of professional experience.";
    store.runSourceFetch.mockResolvedValue({
      jobs: [recent, old, gated],
      diagnostics: [{ source: "remoteok", ok: true, raw: 3 }],
    });

    const result = await discoverGlobalFetchRun(
      input({
        sources: ["remoteok"],
        queries: ["AI Engineer"],
        hoursOld: 24 * 30,
        applyExcludes: true,
        excludeDescriptionRules: ["experience_requirement_4_plus"],
      }),
    );

    expect(result).toMatchObject({
      kind: "commit",
      discovered: 1,
      items: [
        expect.objectContaining({ jobUrl: recent.jobUrl, market: "GLOBAL" }),
      ],
    });
  });

  it("lets discovery exceptions reach the executor recovery policy", async () => {
    store.runSourceFetch.mockRejectedValue(new Error("boom"));

    await expect(
      discoverGlobalFetchRun(input({ queries: ["AI Engineer"] })),
    ).rejects.toThrow("boom");
  });

  it("fails before network I/O when a legacy run exceeds the source budget", async () => {
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

    await expect(
      discoverGlobalFetchRun(input({ queries: ["AI Engineer"] })),
    ).rejects.toThrow("source limit exceeded");
    expect(store.runSourceFetch).not.toHaveBeenCalled();
  });
});
