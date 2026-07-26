import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  runCnFetch: vi.fn(),
  commitFetchRun: vi.fn(),
}));

vi.mock("./runCnFetch", () => ({ runCnFetch: harness.runCnFetch }));
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
    commitFetchRun: harness.commitFetchRun,
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

import { processCnFetchRun } from "./processFetchRun";
import { FetchRunCommitError } from "@/lib/server/fetchRuns/fetchRunCommit";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const run = {
  id: "run-1",
  attemptId: ATTEMPT_ID,
  queries: {
    queries: ["Java Engineer"],
    sources: ["nowcoder"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.commitFetchRun.mockResolvedValue({
    disposition: "APPLIED",
    batchImported: 1,
    batchInvalid: 0,
    totalImported: 1,
    status: "SUCCEEDED",
  });
});

describe("processCnFetchRun", () => {
  it("commits normalized discoveries through the shared protocol", async () => {
    const row = {
      jobUrl: "https://www.nowcoder.com/jobs/detail/1",
      title: "Java Backend Engineer",
      company: "Acme",
      location: "Shanghai",
      jobType: "fulltime",
      jobLevel: "junior",
      description: "Java Spring",
      listingDate: "2026-07-20T00:00:00.000Z",
      market: "CN" as const,
      source: "nowcoder" as const,
    };
    harness.runCnFetch.mockResolvedValue({ jobs: [row], diagnostics: [] });

    const result = await processCnFetchRun("user-1", run);

    expect(harness.commitFetchRun).toHaveBeenCalledWith({
      protocol: "fetch-run-commit/v1",
      command: "commit",
      runId: "run-1",
      attemptId: ATTEMPT_ID,
      batchKey: "cn-result-v1",
      batchIndex: 0,
      batchCount: 1,
      items: [row],
      terminal: true,
      discoveredCount: 1,
      terminalOutcome: "SUCCEEDED",
    });
    expect(result).toEqual({
      userId: "user-1",
      runId: "run-1",
      discovered: 1,
      imported: 1,
    });
  });

  it("terminally commits an empty successful result", async () => {
    harness.runCnFetch.mockResolvedValue({ jobs: [], diagnostics: [] });
    harness.commitFetchRun.mockResolvedValue({
      disposition: "APPLIED",
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "SUCCEEDED",
    });

    const result = await processCnFetchRun("user-1", run);

    expect(result.imported).toBe(0);
    expect(harness.commitFetchRun).toHaveBeenCalledWith(
      expect.objectContaining({ items: [], terminal: true }),
    );
  });

  it("records a failure when every configured source failed", async () => {
    harness.runCnFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        {
          source: "nowcoder",
          ok: false,
          raw: 0,
          error: "nowcoder_503",
        },
      ],
    });

    const result = await processCnFetchRun("user-1", run);

    expect(harness.commitFetchRun).toHaveBeenCalledWith({
      protocol: "fetch-run-commit/v1",
      command: "fail",
      runId: "run-1",
      attemptId: ATTEMPT_ID,
      error: "all sources failed: nowcoder: nowcoder_503",
    });
    expect(result.error).toBe("all sources failed: nowcoder: nowcoder_503");
  });

  it("treats a cancellation that wins before commit as a clean stop", async () => {
    harness.runCnFetch.mockResolvedValue({
      jobs: [
        {
          jobUrl: "https://www.nowcoder.com/jobs/detail/1",
          title: "Java Engineer",
          market: "CN",
        },
      ],
      diagnostics: [],
    });
    harness.commitFetchRun.mockRejectedValue(
      new FetchRunCommitError("RUN_CANCELLED", "Fetch run was cancelled"),
    );

    const result = await processCnFetchRun("user-1", run);

    expect(result.cancelled).toBe(true);
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
  });

  it("reports a same-attempt batch content conflict as a run failure", async () => {
    harness.runCnFetch.mockResolvedValue({
      jobs: [
        {
          jobUrl: "https://www.nowcoder.com/jobs/detail/1",
          title: "Java Engineer",
          market: "CN",
        },
      ],
      diagnostics: [],
    });
    harness.commitFetchRun
      .mockRejectedValueOnce(
        new FetchRunCommitError(
          "BATCH_CONTENT_CONFLICT",
          "Batch key was reused with different content",
        ),
      )
      .mockResolvedValueOnce({
        disposition: "APPLIED",
        batchImported: 0,
        batchInvalid: 0,
        totalImported: 0,
        status: "FAILED",
      });

    const result = await processCnFetchRun("user-1", run);

    expect(result).toMatchObject({
      error: "Batch key was reused with different content",
    });
    expect(result.cancelled).toBeUndefined();
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(2);
    expect(harness.commitFetchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: "fail",
        attemptId: run.attemptId,
      }),
    );
  });

  it("reports supersession when failure reporting discovers a newer executor", async () => {
    harness.runCnFetch.mockRejectedValue(new Error("source timeout"));
    harness.commitFetchRun.mockRejectedValue(
      new FetchRunCommitError(
        "EXECUTION_LEASE_LOST",
        "Another executor owns the run",
      ),
    );

    const result = await processCnFetchRun("user-1", run);

    expect(result).toMatchObject({
      userId: "user-1",
      runId: "run-1",
      discovered: 0,
      imported: 0,
      superseded: true,
    });
    expect(result.error).toBeUndefined();
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
  });
});
