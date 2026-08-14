import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  commitFetchRun: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/server/fetchRuns/fetchRun", () => {
  class FetchRunCommitError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 409,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = "FetchRunCommitError";
    }
  }
  return {
    FETCH_RUN_COMMIT_PROTOCOL: "fetch-run-commit/v1",
    FetchRunCommitError,
    commitFetchRun: harness.commitFetchRun,
  };
});

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: harness.reportError,
}));

import { POST } from "@/app/api/fetch-runs/[id]/commit/route";
import {
  FETCH_RUN_COMMIT_PROTOCOL,
  FetchRunCommitError,
} from "@/lib/server/fetchRuns/fetchRun";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

function request(
  body: unknown,
  {
    secret = "fetch-secret",
    raw = false,
  }: { secret?: string; raw?: boolean } = {},
) {
  return new Request(`http://localhost/api/fetch-runs/${RUN_ID}/commit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fetch-run-secret": secret,
    },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function post(req: Request, id = RUN_ID) {
  return POST(req, { params: Promise.resolve({ id }) });
}

describe("fetch run commit api", () => {
  beforeEach(() => {
    process.env.FETCH_RUN_SECRET = "fetch-secret";
    harness.commitFetchRun.mockReset().mockResolvedValue({
      disposition: "APPLIED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "RUNNING",
    });
    harness.reportError.mockReset();
  });

  it("fails closed when the service secret is not configured", async () => {
    delete process.env.FETCH_RUN_SECRET;

    const response = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "start",
        attemptId: ATTEMPT_ID,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FETCH_RUN_COMMIT_NOT_CONFIGURED" },
    });
    expect(harness.commitFetchRun).not.toHaveBeenCalled();
  });

  it("rejects an invalid service secret before parsing the body", async () => {
    const response = await post(request("{", { secret: "wrong", raw: true }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(harness.commitFetchRun).not.toHaveBeenCalled();
  });

  it("rejects invalid route parameters and malformed bodies", async () => {
    const invalidParams = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "start",
        attemptId: ATTEMPT_ID,
      }),
      "not-a-uuid",
    );
    expect(invalidParams.status).toBe(400);
    await expect(invalidParams.json()).resolves.toMatchObject({
      error: { code: "INVALID_PARAMS" },
    });

    const invalidBodyError = () =>
      new FetchRunCommitError(
        "INVALID_BODY",
        "Invalid request body",
        400,
        { fieldErrors: {} },
      );
    harness.commitFetchRun.mockRejectedValueOnce(invalidBodyError());
    const invalidJson = await post(request("{", { raw: true }));
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({
      error: { code: "INVALID_BODY" },
    });

    harness.commitFetchRun.mockRejectedValueOnce(invalidBodyError());
    const missingAttempt = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "fail",
        error: "worker failed",
      }),
    );
    expect(missingAttempt.status).toBe(400);

    harness.commitFetchRun.mockRejectedValueOnce(invalidBodyError());
    const invalidStream = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "commit",
        attemptId: ATTEMPT_ID,
        batchKey: "batch 0",
        batchIndex: 1,
        batchCount: 1,
        items: [],
        terminal: false,
        terminalOutcome: "SUCCEEDED",
      }),
    );
    expect(invalidStream.status).toBe(400);
    await expect(invalidStream.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
        details: expect.anything(),
      },
    });
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(3);
  });

  it("passes route identity separately from the untrusted worker payload", async () => {
    harness.commitFetchRun.mockResolvedValueOnce({
      disposition: "APPLIED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 1,
      batchInvalid: 0,
      totalImported: 3,
      status: "SUCCEEDED",
    });

    const response = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "commit",
        attemptId: ATTEMPT_ID,
        runId: "forged-run-id",
        userId: "forged-user-id",
        batchKey: "batch_0",
        batchIndex: 0,
        batchCount: 1,
        items: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Platform Engineer",
            market: "AU",
          },
        ],
        terminal: true,
        discoveredCount: 3,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      disposition: "APPLIED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 1,
      batchInvalid: 0,
      totalImported: 3,
      status: "SUCCEEDED",
    });
    expect(harness.commitFetchRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      wireCommand: {
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "commit",
        runId: "forged-run-id",
        userId: "forged-user-id",
        attemptId: ATTEMPT_ID,
        batchKey: "batch_0",
        batchIndex: 0,
        batchCount: 1,
        items: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Platform Engineer",
            market: "AU",
          },
        ],
        terminal: true,
        discoveredCount: 3,
      },
    });
  });

  it("maps protocol conflicts to their stable API error", async () => {
    harness.commitFetchRun.mockRejectedValueOnce(
      new FetchRunCommitError(
        "BATCH_OUT_OF_ORDER",
        "Batch arrived out of order",
        409,
        { expected: 0, received: 1 },
      ),
    );

    const response = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "commit",
        attemptId: ATTEMPT_ID,
        batchKey: "batch-1",
        batchIndex: 1,
        batchCount: 2,
        items: [],
        terminal: true,
        discoveredCount: 0,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BATCH_OUT_OF_ORDER",
        message: "Batch arrived out of order",
        details: { expected: 0, received: 1 },
      },
    });
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("maps the module's retired-market error to the stable HTTP error", async () => {
    harness.commitFetchRun.mockRejectedValueOnce(
      new FetchRunCommitError(
        "RUN_MARKET_RETIRED",
        "This fetch market has been retired",
        410,
      ),
    );
    const response = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "start",
        attemptId: ATTEMPT_ID,
      }),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FETCH_MARKET_RETIRED" },
    });
    expect(harness.commitFetchRun).toHaveBeenCalledTimes(1);
  });

  it("reports unexpected commit failures without leaking internals", async () => {
    harness.commitFetchRun.mockRejectedValueOnce(new Error("database details"));

    const response = await post(
      request({
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "fail",
        attemptId: ATTEMPT_ID,
        error: "worker failed",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "FETCH_RUN_COMMIT_FAILED",
        message: "Fetch run commit failed",
      },
    });
    expect(harness.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: "fetchRuns.commit",
        tags: { runId: RUN_ID },
      }),
    );
  });
});
