import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  commitFetchRun: vi.fn(),
  runSourceFetch: vi.fn(),
  loadAtsAdapters: vi.fn(),
  recoverAtsBoards: vi.fn(),
  persistHealth: vi.fn(),
  reconcileLiveness: vi.fn(),
}));

vi.mock("@/lib/server/fetchRuns/fetchRunCommit", () => {
  class MockFetchRunCommitError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 409,
    ) {
      super(message);
    }
  }
  return {
    FETCH_RUN_COMMIT_PROTOCOL: "fetch-run-commit/v1",
    FetchRunCommitError: MockFetchRunCommitError,
    commitFetchRun: store.commitFetchRun,
    fetchRunExecutionStopReason: (error: unknown) => {
      if (!(error instanceof MockFetchRunCommitError)) return null;
      if (error.code === "RUN_CANCELLED") return "cancelled";
      return [
        "RUN_ALREADY_TERMINAL",
        "EXECUTION_LEASE_HELD",
        "EXECUTION_LEASE_LOST",
      ].includes(error.code)
        ? "superseded"
        : null;
    },
  };
});
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
import { FetchRunCommitError } from "@/lib/server/fetchRuns/fetchRunCommit";
import { buildGlobalFetchRunConfigV1 } from "@/lib/shared/schemas/fetchRunConfig";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";

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
  store.commitFetchRun.mockImplementation(
    async (command: {
      command: string;
      attemptId?: string;
      items?: unknown[];
    }) => ({
      disposition: "APPLIED",
      executionAttemptId: command.attemptId ?? null,
      batchImported:
        command.command === "commit" && command.items?.length ? 1 : 0,
      batchInvalid: 0,
      totalImported:
        command.command === "commit" && command.items?.length ? 1 : 0,
      status: command.command === "fail" ? "FAILED" : "SUCCEEDED",
    }),
  );
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
    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 2, imported: 1 });
    expect(store.commitFetchRun.mock.invocationCallOrder[0]).toBeLessThan(
      store.persistHealth.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(store.commitFetchRun.mock.invocationCallOrder[0]).toBeLessThan(
      store.reconcileLiveness.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
    const observedAt = store.persistHealth.mock.calls[0]?.[1];
    expect(observedAt).toBeInstanceOf(Date);
    expect(store.reconcileLiveness).toHaveBeenCalledWith(
      expect.objectContaining({ checkedAt: observedAt }),
    );
  });

  it("executes a historical source-only row without inventing a role filter", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [
        {
          ...sourceJob("https://remoteok.com/remote-jobs/accountant"),
          title: "Commercial Accountant",
        },
      ],
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
    });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-source-only",
      attemptId: ATTEMPT_ID,
      queries: { sources: ["remoteok"] },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
    expect(store.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "commit",
        runId: "run-source-only",
        items: [
          expect.objectContaining({
            title: "Commercial Accountant",
            market: "GLOBAL",
          }),
        ],
      }),
    );
  });

  it("fails closed when an explicit source-only ATS board is no longer enabled", async () => {
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

    const result = await processGlobalFetchRun("user-1", {
      id: "run-disabled-source-only",
      attemptId: ATTEMPT_ID,
      queries: { sources: [disabledSource] },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: [disabledSource],
    });
    expect(result).toEqual({
      discovered: 0,
      imported: 0,
      error: `all sources failed: ${disabledSource}: unknown_source`,
    });
    expect(store.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "fail",
        runId: "run-disabled-source-only",
        error: `all sources failed: ${disabledSource}: unknown_source`,
      }),
    );
  });

  it("returns the error it wrote to the run when every source failed", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: false, raw: 0, error: "HTTP 503" }],
    });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
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
      attemptId: ATTEMPT_ID,
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
      attemptId: ATTEMPT_ID,
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
      attemptId: ATTEMPT_ID,
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", "ats:greenhouse:acme"],
      adapters: expect.arrayContaining([adapter]),
    });
    expect(store.persistHealth).toHaveBeenCalledWith(
      diagnostics,
      expect.any(Date),
    );
    expect(store.recoverAtsBoards).toHaveBeenCalledWith({
      boards: [board],
      diagnostics,
    });
  });

  it("executes a versioned all-source run from its creation-time source snapshot", async () => {
    const persistedSource = "ats:greenhouse:persisted";
    const newlyEnabledSource = "ats:greenhouse:new";
    const newlyEnabledAdapter = {
      id: newlyEnabledSource,
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

    await processGlobalFetchRun("user-1", {
      id: "run-snapshotted-all",
      attemptId: ATTEMPT_ID,
      queries: buildGlobalFetchRunConfigV1({
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
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", persistedSource],
      adapters: expect.arrayContaining([newlyEnabledAdapter]),
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
      attemptId: ATTEMPT_ID,
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

  it("keeps an unavailable source in a mixed explicit selection and reports PARTIAL", async () => {
    const disabledSource = "ats:greenhouse:disabled";
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
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

    const result = await processGlobalFetchRun("user-1", {
      id: "run-mixed-explicit",
      attemptId: ATTEMPT_ID,
      queries: {
        sources: ["remoteok", disabledSource],
        sourceSelection: "explicit",
        queries: ["AI Engineer"],
      },
    });

    expect(store.runSourceFetch).toHaveBeenCalledWith({
      sources: ["remoteok", disabledSource],
    });
    expect(result).toEqual({ discovered: 1, imported: 1 });
    expect(store.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "commit",
        runId: "run-mixed-explicit",
        terminalOutcome: "PARTIAL",
        error: `${disabledSource}: unknown_source`,
      }),
    );
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
    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { sources: [adapter.id], queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
    expect(store.persistHealth).toHaveBeenCalledWith(
      [{ source: adapter.id, ok: true, raw: 1 }],
      expect.any(Date),
    );
    expect(store.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "commit",
        runId: "run-1",
        attemptId: ATTEMPT_ID,
        items: [
          expect.objectContaining({
            jobUrl: recovered.jobs[0].jobUrl,
            market: "GLOBAL",
          }),
        ],
      }),
    );
  });

  it("succeeds with zero imports when a healthy source returns nothing", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [{ source: "remoteok", ok: true, raw: 0 }],
    });

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0 });
    expect(store.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "commit",
        items: [],
        terminal: true,
      }),
    );
  });

  it("still succeeds when only some sources failed", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [
        { source: "remoteok", ok: true, raw: 1 },
        { source: "jobicy", ok: false, raw: 0, error: "timeout" },
      ],
    });
    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
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
    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: {
        sources: ["remoteok"],
        queries: ["AI Engineer"],
        hoursOld: 24 * 30,
        applyExcludes: true,
        excludeDescriptionRules: ["experience_requirement_4_plus"],
      },
    });

    expect(result).toEqual({ discovered: 1, imported: 1 });
    expect(store.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "commit",
        items: [
          expect.objectContaining({ jobUrl: recent.jobUrl, market: "GLOBAL" }),
        ],
      }),
    );
  });

  it("surfaces a thrown fetch as an error result rather than rejecting", async () => {
    store.runSourceFetch.mockRejectedValue(new Error("boom"));

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0, error: "boom" });
    expect(store.commitFetchRun).toHaveBeenCalledWith({
      protocol: "fetch-run-commit/v1",
      command: "fail",
      runId: "run-1",
      attemptId: ATTEMPT_ID,
      error: "boom",
    });
  });

  it("reports supersession when failure reporting discovers a newer executor", async () => {
    store.runSourceFetch.mockRejectedValue(new Error("boom"));
    store.commitFetchRun.mockRejectedValue(
      new FetchRunCommitError(
        "EXECUTION_LEASE_LOST",
        "Another executor owns the run",
      ),
    );

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({
      discovered: 0,
      imported: 0,
      superseded: true,
    });
    expect(store.commitFetchRun).toHaveBeenCalledTimes(1);
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
      attemptId: ATTEMPT_ID,
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
    store.commitFetchRun.mockRejectedValue(
      new FetchRunCommitError("RUN_CANCELLED", "Fetch run was cancelled"),
    );

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0, cancelled: true });
    expect(store.commitFetchRun).toHaveBeenCalledTimes(1);
  });

  it("does not fail the canonical run when this executor loses the batch stream", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
    });
    store.commitFetchRun.mockRejectedValue(
      new FetchRunCommitError(
        "EXECUTION_LEASE_LOST",
        "Another executor owns the run",
      ),
    );

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({ discovered: 0, imported: 0, superseded: true });
    expect(store.commitFetchRun).toHaveBeenCalledTimes(1);
    expect(store.persistHealth).not.toHaveBeenCalled();
    expect(store.reconcileLiveness).not.toHaveBeenCalled();
  });

  it("does not publish stale observations when an identical receipt belongs to attempt B", async () => {
    const canonicalDiagnostics = [
      { source: "remoteok", ok: true, raw: 0 },
    ];
    const staleDiagnostics = [
      { source: "remoteok", ok: true, raw: 99 },
    ];
    store.runSourceFetch
      .mockResolvedValueOnce({
        jobs: [],
        diagnostics: canonicalDiagnostics,
      })
      .mockResolvedValueOnce({
        jobs: [
          {
            ...sourceJob("https://remoteok.com/remote-jobs/accountant"),
            title: "Commercial Accountant",
          },
        ],
        diagnostics: staleDiagnostics,
      });
    store.commitFetchRun.mockImplementation(
      async (command: {
        command: string;
        attemptId?: string;
        items?: unknown[];
      }) => ({
        disposition:
          command.attemptId === OTHER_ATTEMPT_ID ? "APPLIED" : "REPLAYED",
        executionAttemptId: OTHER_ATTEMPT_ID,
        batchImported: 0,
        batchInvalid: 0,
        totalImported: 0,
        status: "SUCCEEDED",
      }),
    );

    await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: OTHER_ATTEMPT_ID,
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });
    await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { sources: ["remoteok"], queries: ["AI Engineer"] },
    });

    const commitCommands = store.commitFetchRun.mock.calls
      .map(([command]) => command)
      .filter((command) => command.command === "commit");
    expect(commitCommands).toHaveLength(2);
    expect(commitCommands[0]).toMatchObject({
      attemptId: OTHER_ATTEMPT_ID,
      items: [],
      terminal: true,
    });
    expect(commitCommands[1]).toMatchObject({
      attemptId: ATTEMPT_ID,
      items: [],
      terminal: true,
    });
    expect(store.persistHealth).toHaveBeenCalledTimes(1);
    expect(store.persistHealth).toHaveBeenCalledWith(
      canonicalDiagnostics,
      expect.any(Date),
    );
    expect(store.persistHealth).not.toHaveBeenCalledWith(
      staleDiagnostics,
      expect.any(Date),
    );
    expect(store.reconcileLiveness).toHaveBeenCalledTimes(1);
  });

  it("reports a malformed local batch stream instead of masking it as cancellation", async () => {
    store.runSourceFetch.mockResolvedValue({
      jobs: [sourceJob("https://remoteok.com/remote-jobs/1")],
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
    });
    store.commitFetchRun.mockRejectedValue(
      new FetchRunCommitError(
        "BATCH_OUT_OF_ORDER",
        "Local executor emitted an invalid stream",
      ),
    );

    const result = await processGlobalFetchRun("user-1", {
      id: "run-1",
      attemptId: ATTEMPT_ID,
      queries: { queries: ["AI Engineer"] },
    });

    expect(result).toEqual({
      discovered: 0,
      imported: 0,
      error: "Local executor emitted an invalid stream",
    });
    expect(store.commitFetchRun).toHaveBeenCalledTimes(2);
  });
});
