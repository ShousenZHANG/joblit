import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  findMany: vi.fn(),
  commitFetchRun: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
  },
}));

vi.mock("@/lib/server/fetchRuns/fetchRunCommit", () => ({
  FETCH_RUN_COMMIT_PROTOCOL: "fetch-run-commit/v1",
  FetchRunCommitError: class FetchRunCommitError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
  commitFetchRun: fetchRunStore.commitFetchRun,
}));

import { GET } from "@/app/api/fetch-runs/cleanup-stuck/route";

describe("fetch run cleanup-stuck api", () => {
  beforeEach(() => {
    fetchRunStore.findMany.mockReset();
    fetchRunStore.commitFetchRun.mockReset().mockResolvedValue({
      disposition: "APPLIED",
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "FAILED",
    });
    process.env.FETCH_RUN_SECRET = "test-secret";
  });

  it("rejects missing secret", async () => {
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck"),
    );
    expect(res.status).toBe(401);
    expect(fetchRunStore.findMany).not.toHaveBeenCalled();
  });

  it("rejects wrong secret", async () => {
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts valid x-fetch-run-secret header", async () => {
    fetchRunStore.findMany.mockResolvedValue([]);
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "test-secret" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("returns swept=0 when no stuck runs", async () => {
    fetchRunStore.findMany.mockResolvedValue([]);
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "test-secret" },
      }),
    );
    const json = await res.json();
    expect(json.swept).toBe(0);
    expect(fetchRunStore.commitFetchRun).not.toHaveBeenCalled();
  });

  it("flips stuck QUEUED/RUNNING runs to FAILED with timeout error", async () => {
    const stuck = [
      { id: "11111111-1111-1111-1111-111111111111", status: "QUEUED", updatedAt: new Date("2026-02-10T00:00:00Z") },
      { id: "22222222-2222-2222-2222-222222222222", status: "RUNNING", updatedAt: new Date("2026-02-10T00:00:00Z") },
    ];
    fetchRunStore.findMany.mockResolvedValue(stuck);
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "test-secret" },
      }),
    );
    const json = await res.json();

    expect(json.swept).toBe(2);
    expect(json.ids).toEqual([stuck[0].id, stuck[1].id]);
    expect(fetchRunStore.commitFetchRun).toHaveBeenCalledTimes(2);
    expect(fetchRunStore.commitFetchRun).toHaveBeenNthCalledWith(1, {
      protocol: "fetch-run-commit/v1",
      command: "fail",
      runId: stuck[0].id,
      error: expect.stringContaining("Dispatch timeout"),
      staleBefore: expect.any(Date),
    });
  });

  it("returns 503 when FETCH_RUN_SECRET env is not configured", async () => {
    delete process.env.FETCH_RUN_SECRET;
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "anything" },
      }),
    );
    expect(res.status).toBe(503);
  });
});
