import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
  },
}));

import { PATCH } from "@/app/api/fetch-runs/[id]/update/route";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeReq(body: unknown, secret = "secret") {
  return new Request(`http://localhost/api/fetch-runs/${RUN_ID}/update`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-fetch-run-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

describe("fetch run update api", () => {
  beforeEach(() => {
    fetchRunStore.findUnique.mockReset();
    fetchRunStore.updateMany.mockReset().mockResolvedValue({ count: 1 });
    process.env.FETCH_RUN_SECRET = "secret";
  });

  it("does not overwrite cancelled runs with SUCCEEDED", async () => {
    fetchRunStore.findUnique.mockResolvedValueOnce({
      id: RUN_ID,
      status: "FAILED",
      error: "Cancelled by user",
      importedCount: 10,
    });

    const res = await PATCH(makeReq({ status: "SUCCEEDED", importedCount: 20, error: null }), {
      params: Promise.resolve({ id: RUN_ID }),
    });

    expect(res.status).toBe(200);
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        status: "FAILED",
        error: "Cancelled by user",
        importedCount: 10,
      },
      data: { importedCount: 20 },
    });
  });

  it("keeps SUCCEEDED as terminal and ignores status/error changes", async () => {
    fetchRunStore.findUnique.mockResolvedValueOnce({
      id: RUN_ID,
      status: "SUCCEEDED",
      error: null,
      importedCount: 5,
    });

    const res = await PATCH(makeReq({ status: "FAILED", importedCount: 9, error: "oops" }), {
      params: Promise.resolve({ id: RUN_ID }),
    });

    expect(res.status).toBe(200);
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        status: "SUCCEEDED",
        error: null,
        importedCount: 5,
      },
      data: { importedCount: 9 },
    });
  });

  it("allows QUEUED -> RUNNING transition", async () => {
    fetchRunStore.findUnique.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      error: null,
      importedCount: 0,
    });

    const res = await PATCH(makeReq({ status: "RUNNING" }), {
      params: Promise.resolve({ id: RUN_ID }),
    });

    expect(res.status).toBe(200);
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        status: "QUEUED",
        error: null,
        importedCount: 0,
      },
      data: { status: "RUNNING" },
    });
  });

  it("returns 409 when cancellation wins the compare-and-swap", async () => {
    fetchRunStore.findUnique.mockResolvedValueOnce({
      id: RUN_ID,
      status: "RUNNING",
      error: null,
      importedCount: 0,
    });
    fetchRunStore.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await PATCH(
      makeReq({ status: "SUCCEEDED", importedCount: 20 }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "STATE_CHANGED" });
  });
});
