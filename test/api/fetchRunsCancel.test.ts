import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  cancelFetchRun: vi.fn(),
}));

vi.mock("@/lib/server/fetchRuns/fetchRun", () => ({
  cancelFetchRun: store.cancelFetchRun,
}));

vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/fetch-runs/[id]/cancel/route";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

function cancel() {
  return POST(
    new Request(`http://localhost/api/fetch-runs/${RUN_ID}/cancel`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: RUN_ID }) },
  );
}

describe("fetch run cancel api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    store.cancelFetchRun.mockReset();
  });

  it("cancels only an active run owned by the current user", async () => {
    store.cancelFetchRun.mockResolvedValueOnce({
      kind: "cancelled",
      status: "FAILED",
    });

    const response = await cancel();

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      ok: true,
      status: "FAILED",
    });
    expect(store.cancelFetchRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      userId: "user-1",
    });
  });

  it("preserves committed batches as a PARTIAL terminal result", async () => {
    store.cancelFetchRun.mockResolvedValueOnce({
      kind: "cancelled",
      status: "PARTIAL",
    });

    const response = await cancel();

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      ok: true,
      status: "PARTIAL",
    });
  });

  it("cannot overwrite a run that completed before the lifecycle lock", async () => {
    store.cancelFetchRun.mockResolvedValueOnce({
      kind: "finished",
      status: "SUCCEEDED",
    });

    const response = await cancel();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ALREADY_FINISHED",
        message: "The fetch run already finished",
        details: { status: "SUCCEEDED" },
      },
    });
  });
});
