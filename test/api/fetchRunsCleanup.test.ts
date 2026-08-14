import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  sweepStaleFetchRuns: vi.fn(),
}));

vi.mock("@/lib/server/fetchRuns/fetchRun", () => ({
  sweepStaleFetchRuns: fetchRunStore.sweepStaleFetchRuns,
}));

import { GET } from "@/app/api/fetch-runs/cleanup-stuck/route";

describe("fetch run cleanup-stuck api", () => {
  beforeEach(() => {
    fetchRunStore.sweepStaleFetchRuns.mockReset().mockResolvedValue({
      ids: [],
      candidateCount: 0,
      staleAfterMs: 30 * 60 * 1000,
    });
    process.env.FETCH_RUN_SECRET = "test-secret";
  });

  it("rejects missing secret", async () => {
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck"),
    );
    expect(res.status).toBe(401);
    expect(fetchRunStore.sweepStaleFetchRuns).not.toHaveBeenCalled();
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
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "test-secret" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("returns swept=0 when no stuck runs", async () => {
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "test-secret" },
      }),
    );
    const json = await res.json();
    expect(json).toEqual({ swept: 0, ids: [] });
    expect(fetchRunStore.sweepStaleFetchRuns).toHaveBeenCalledTimes(1);
  });

  it("flips stuck QUEUED/RUNNING runs to FAILED with timeout error", async () => {
    const ids = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ];
    fetchRunStore.sweepStaleFetchRuns.mockResolvedValue({
      ids,
      candidateCount: 2,
      staleAfterMs: 30 * 60 * 1000,
    });
    const res = await GET(
      new Request("http://localhost/api/fetch-runs/cleanup-stuck", {
        headers: { "x-fetch-run-secret": "test-secret" },
      }),
    );
    const json = await res.json();

    expect(json.swept).toBe(2);
    expect(json.ids).toEqual(ids);
    expect(json.thresholdMinutes).toBe(30);
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
