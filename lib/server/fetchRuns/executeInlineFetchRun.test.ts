import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  cn: vi.fn(),
  global: vi.fn(),
  commitFetchRun: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/server/cnFetch/processFetchRun", () => ({
  discoverCnFetchRun: harness.cn,
}));
vi.mock("@/lib/server/sources/processGlobalFetchRun", () => ({
  discoverGlobalFetchRun: harness.global,
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: {
      updateMany: harness.updateMany,
      findFirst: harness.findFirst,
    },
  },
}));
vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: harness.reportError,
}));
vi.mock("@/lib/server/fetchRuns/fetchRunCommit", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/lib/server/fetchRuns/fetchRunCommit")
    >();
  return { ...original, commitFetchRun: harness.commitFetchRun };
});

import { executeInlineFetchRun } from "./executeInlineFetchRun";
import { FetchRunCommitError } from "./fetchRunCommit";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const request = {
  runId: "run-1",
  userId: "user-1",
  idempotencyKey: null,
};

function claim(market: "CN" | "GLOBAL") {
  return {
    kind: "locked" as const,
    market,
    queries: { queries: ["Engineer"] },
    claimedQueries: { queries: ["Engineer"] },
    attemptId: ATTEMPT_ID,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.updateMany.mockResolvedValue({ count: 1 });
  harness.findFirst.mockResolvedValue(null);
  harness.commitFetchRun
    .mockResolvedValueOnce({
      disposition: "APPLIED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "RUNNING",
    })
    .mockResolvedValue({
      disposition: "APPLIED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 2,
      batchInvalid: 0,
      totalImported: 2,
      status: "SUCCEEDED",
    });
});

describe("executeInlineFetchRun", () => {
  it.each([
    ["CN", harness.cn, "cn-result-v1"],
    ["GLOBAL", harness.global, "global-result-v1"],
  ] as const)(
    "applies the same start and terminal commit policy to %s discovery",
    async (market, adapter, batchKey) => {
      adapter.mockResolvedValue({
        kind: "commit",
        batchKey,
        items: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Engineer",
            market,
          },
        ],
        discovered: 1,
        terminalOutcome: "SUCCEEDED",
      });

      const result = await executeInlineFetchRun(request, claim(market));

      expect(result).toEqual({
        kind: "completed",
        discovered: 1,
        imported: 2,
      });
      expect(harness.commitFetchRun).toHaveBeenNthCalledWith(1, {
        protocol: "fetch-run-commit/v1",
        command: "start",
        runId: "run-1",
        attemptId: ATTEMPT_ID,
      });
      expect(harness.commitFetchRun).toHaveBeenNthCalledWith(2, {
        protocol: "fetch-run-commit/v1",
        command: "commit",
        runId: "run-1",
        attemptId: ATTEMPT_ID,
        batchKey,
        batchIndex: 0,
        batchCount: 1,
        items: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Engineer",
            market,
          },
        ],
        terminal: true,
        discoveredCount: 1,
        terminalOutcome: "SUCCEEDED",
      });
      expect(harness.commitFetchRun.mock.invocationCallOrder[0]).toBeLessThan(
        adapter.mock.invocationCallOrder[0],
      );
      expect(adapter.mock.invocationCallOrder[0]).toBeLessThan(
        harness.commitFetchRun.mock.invocationCallOrder[1],
      );
    },
  );

  it("does not rewrite a durable terminal commit when its projection hook fails", async () => {
    const projectionError = new Error("source health unavailable");
    const postTerminal = vi.fn().mockRejectedValue(projectionError);
    harness.cn.mockResolvedValue({
      kind: "commit",
      batchKey: "cn-result-v1",
      items: [],
      discovered: 0,
      terminalOutcome: "SUCCEEDED",
      postTerminal,
    });

    const result = await executeInlineFetchRun(request, claim("CN"));

    expect(result).toEqual({
      kind: "completed",
      discovered: 0,
      imported: 2,
    });
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(2);
    expect(postTerminal).toHaveBeenCalledOnce();
    expect(harness.reportError).toHaveBeenCalledWith(
      projectionError,
      expect.objectContaining({
        scope: "fetch-runs.inline.post-terminal",
        userId: "user-1",
      }),
    );
  });

  it.each([
    ["CN", harness.cn],
    ["GLOBAL", harness.global],
  ] as const)(
    "applies the same durable failure policy to %s diagnostics",
    async (market, adapter) => {
      const postTerminal = vi.fn();
      adapter.mockResolvedValue({
        kind: "fail",
        error: "all sources failed: upstream unavailable",
        postTerminal,
      });

      const result = await executeInlineFetchRun(request, claim(market));

      expect(result).toEqual({ kind: "failed", market });
      expect(harness.commitFetchRun).toHaveBeenNthCalledWith(2, {
        protocol: "fetch-run-commit/v1",
        command: "fail",
        runId: "run-1",
        attemptId: ATTEMPT_ID,
        error: "all sources failed: upstream unavailable",
      });
      expect(postTerminal).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["CN", harness.cn],
    ["GLOBAL", harness.global],
  ] as const)(
    "recovers a thrown %s discovery through the same terminal fail command",
    async (market, adapter) => {
      adapter.mockRejectedValue(new Error("source timeout"));

      const result = await executeInlineFetchRun(request, claim(market));

      expect(result).toEqual({ kind: "failed", market });
      expect(harness.commitFetchRun).toHaveBeenNthCalledWith(2, {
        protocol: "fetch-run-commit/v1",
        command: "fail",
        runId: "run-1",
        attemptId: ATTEMPT_ID,
        error: "source timeout",
      });
    },
  );

  it.each([
    ["RUN_CANCELLED", "cancelled"],
    ["EXECUTION_LEASE_LOST", "superseded"],
  ] as const)(
    "projects %s from the terminal commit without issuing a second fail",
    async (code, expectedKind) => {
      harness.global.mockResolvedValue({
        kind: "commit",
        batchKey: "global-result-v1",
        items: [],
        discovered: 0,
        terminalOutcome: "SUCCEEDED",
      });
      harness.commitFetchRun.mockReset()
        .mockResolvedValueOnce({
          disposition: "APPLIED",
          executionAttemptId: ATTEMPT_ID,
          batchImported: 0,
          batchInvalid: 0,
          totalImported: 0,
          status: "RUNNING",
        })
        .mockRejectedValueOnce(
          new FetchRunCommitError(code, "execution stopped"),
        );

      const result = await executeInlineFetchRun(request, claim("GLOBAL"));

      expect(result).toEqual({ kind: expectedKind });
      expect(harness.commitFetchRun).toHaveBeenCalledTimes(2);
    },
  );

  it("does not publish a projection when a replay receipt belongs to another attempt", async () => {
    const postTerminal = vi.fn();
    harness.global.mockResolvedValue({
      kind: "commit",
      batchKey: "global-result-v1",
      items: [],
      discovered: 0,
      terminalOutcome: "SUCCEEDED",
      postTerminal,
    });
    harness.commitFetchRun.mockReset()
      .mockResolvedValueOnce({
        disposition: "APPLIED",
        executionAttemptId: ATTEMPT_ID,
        batchImported: 0,
        batchInvalid: 0,
        totalImported: 0,
        status: "RUNNING",
      })
      .mockResolvedValueOnce({
        disposition: "REPLAYED",
        executionAttemptId: "22222222-2222-4222-8222-222222222222",
        batchImported: 0,
        batchInvalid: 0,
        totalImported: 3,
        status: "SUCCEEDED",
      });

    const result = await executeInlineFetchRun(request, claim("GLOBAL"));

    expect(result).toEqual({
      kind: "completed",
      discovered: 0,
      imported: 3,
    });
    expect(postTerminal).not.toHaveBeenCalled();
  });

  it("recovers a durable terminal commit when its response is lost", async () => {
    const postTerminal = vi.fn();
    harness.global.mockResolvedValue({
      kind: "commit",
      batchKey: "global-result-v1",
      items: [],
      discovered: 4,
      terminalOutcome: "SUCCEEDED",
      postTerminal,
    });
    harness.commitFetchRun.mockReset()
      .mockResolvedValueOnce({
        disposition: "APPLIED",
        executionAttemptId: ATTEMPT_ID,
        batchImported: 0,
        batchInvalid: 0,
        totalImported: 0,
        status: "RUNNING",
      })
      .mockRejectedValueOnce(new Error("commit response lost"))
      .mockResolvedValueOnce({
        disposition: "REPLAYED",
        executionAttemptId: ATTEMPT_ID,
        batchImported: 0,
        batchInvalid: 0,
        totalImported: 2,
        status: "SUCCEEDED",
      });

    const result = await executeInlineFetchRun(request, claim("GLOBAL"));

    expect(result).toEqual({
      kind: "completed",
      discovered: 4,
      imported: 2,
    });
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(3);
    expect(harness.commitFetchRun).toHaveBeenNthCalledWith(3, {
      protocol: "fetch-run-commit/v1",
      command: "fail",
      runId: "run-1",
      attemptId: ATTEMPT_ID,
      error: "commit response lost",
    });
    expect(postTerminal).toHaveBeenCalledOnce();
  });

  it("does not start discovery when the running projection is no longer active", async () => {
    harness.updateMany.mockResolvedValue({ count: 0 });

    const result = await executeInlineFetchRun(request, claim("CN"));

    expect(result).toEqual({ kind: "no_longer_active" });
    expect(harness.cn).not.toHaveBeenCalled();
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
  });

  it("reports cancellation when metadata persistence loses the active row", async () => {
    harness.updateMany.mockResolvedValue({ count: 0 });
    harness.findFirst.mockResolvedValue({
      status: "FAILED",
      error: "Cancelled by user",
      executionAttemptId: ATTEMPT_ID,
    });

    const result = await executeInlineFetchRun(request, claim("CN"));

    expect(result).toEqual({ kind: "cancelled" });
    expect(harness.cn).not.toHaveBeenCalled();
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
  });

  it("reports takeover when metadata persistence loses ownership", async () => {
    harness.updateMany.mockResolvedValue({ count: 0 });
    harness.findFirst.mockResolvedValue({
      status: "RUNNING",
      error: null,
      executionAttemptId: "22222222-2222-4222-8222-222222222222",
    });

    const result = await executeInlineFetchRun(request, claim("GLOBAL"));

    expect(result).toEqual({ kind: "superseded" });
    expect(harness.global).not.toHaveBeenCalled();
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
  });

  it("terminally fails an owned run when dispatch metadata persistence throws after start", async () => {
    harness.updateMany.mockRejectedValue(
      new Error("dispatch metadata unavailable"),
    );

    const result = await executeInlineFetchRun(request, claim("CN"));

    expect(result).toEqual({ kind: "failed", market: "CN" });
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(2);
    expect(harness.commitFetchRun).toHaveBeenNthCalledWith(2, {
      protocol: "fetch-run-commit/v1",
      command: "fail",
      runId: "run-1",
      attemptId: ATTEMPT_ID,
      error: "dispatch metadata unavailable",
    });
    expect(harness.cn).not.toHaveBeenCalled();
  });

  it.each([
    ["RUN_CANCELLED", "cancelled"],
    ["EXECUTION_LEASE_HELD", "superseded"],
  ] as const)(
    "does not issue fail when start reports %s",
    async (code, expectedKind) => {
      harness.commitFetchRun.mockReset().mockRejectedValueOnce(
        new FetchRunCommitError(code, "start stopped"),
      );

      const result = await executeInlineFetchRun(request, claim("CN"));

      expect(result).toEqual({ kind: expectedKind });
      expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
      expect(harness.updateMany).not.toHaveBeenCalled();
      expect(harness.cn).not.toHaveBeenCalled();
    },
  );
});
