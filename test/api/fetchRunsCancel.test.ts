import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  executeRawLock: vi.fn(),
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
    store.executeRawLock.mockResolvedValue(1);
    store.updateMany.mockResolvedValue({ count: 1 });
  });

  it("cancels only an active run owned by the current user", async () => {
    store.findFirst.mockResolvedValueOnce({ id: RUN_ID, status: "RUNNING" });

    const response = await cancel();

    expect(response.status).toBe(200);
    expect(store.executeRawLock).toHaveBeenCalled();
    expect(store.updateMany).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        userId: "user-1",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { status: "FAILED", error: "Cancelled by user" },
    });
  });

  it("cannot overwrite a run that completed before the lifecycle lock", async () => {
    store.findFirst.mockResolvedValueOnce({ id: RUN_ID, status: "SUCCEEDED" });

    const response = await cancel();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "ALREADY_FINISHED",
      status: "SUCCEEDED",
    });
    expect(store.updateMany).not.toHaveBeenCalled();
  });
});
