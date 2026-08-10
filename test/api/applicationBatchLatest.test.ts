import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/application-batches/latest/route";

describe("application batch latest api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
  });

  it("falls back to the most recent batch when none is active", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    // First query (active-only) finds nothing; the fallback answers.
    applicationBatchStore.findFirst.mockResolvedValueOnce(null);
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "SUCCEEDED",
      updatedAt: new Date("2026-02-22T10:10:00.000Z"),
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batchId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(json.status).toBe("SUCCEEDED");
    expect(typeof json.updatedAt).toBe("string");
    expect(applicationBatchStore.findFirst).toHaveBeenCalledTimes(2);
  });

  it("prefers a live batch over a terminal one that was touched more recently", async () => {
    // Ordering by updatedAt alone looked equivalent while the live batch was
    // always the most recently touched row. It is not: a Runner replaying a
    // receipt against an already-terminal batch bumps that row after a newer
    // batch was queued. The browser was then handed the finished batch, never
    // adopted the live one, and showed no progress for work that was running.
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: "660e8400-e29b-41d4-a716-446655440111",
      status: "RUNNING",
      updatedAt: new Date("2026-02-22T09:00:00.000Z"),
    });

    const res = await GET();
    const json = await res.json();

    expect(json.batchId).toBe("660e8400-e29b-41d4-a716-446655440111");
    expect(json.status).toBe("RUNNING");
    // The active lookup answered, so the updatedAt fallback never ran.
    expect(applicationBatchStore.findFirst).toHaveBeenCalledTimes(1);
    expect(applicationBatchStore.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: "user-1",
      status: { in: ["QUEUED", "RUNNING"] },
    });
  });
});
