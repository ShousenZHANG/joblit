import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  applicationBatch: { findFirst: vi.fn() },
  job: { count: vi.fn(), findMany: vi.fn() },
  resumeProfile: { findFirst: vi.fn() },
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: stores,
}));

vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/application-batches/preflight/route";

describe("application batch preflight api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    stores.resumeProfile.findFirst.mockResolvedValue({ id: "profile-1" });
    stores.applicationBatch.findFirst.mockResolvedValue(null);
    stores.job.findMany.mockResolvedValue([{ id: "ready-job" }]);
    stores.job.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
  });

  it("returns the authoritative safe AU NEW selection and safety summary", async () => {
    const res = await GET(
      new Request("http://localhost/api/application-batches/preflight"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      scope: "NEW",
      eligibleCount: 1,
      maxJobs: 100,
      profileReady: true,
      activeBatch: null,
      ready: 1,
      incomplete: 1,
      alreadyGenerated: 1,
      eligibleTotal: 1,
      safeTotal: 1,
      totalNew: 3,
      capped: false,
    });
    expect(stores.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          market: "AU",
          status: "NEW",
          applications: {
            none: {
              userId: "user-1",
            },
          },
        },
        take: 100,
      }),
    );
  });

  it("reports the active batch and distinguishes the capped batch count from the safe total", async () => {
    stores.applicationBatch.findFirst.mockResolvedValueOnce({
      id: "batch-active",
      status: "RUNNING",
      totalCount: 100,
    });
    stores.job.findMany.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, index) => ({
        id: `job-${index + 1}`,
        applications: [],
      })),
    );
    stores.job.count.mockReset();
    stores.job.count
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(7);

    const res = await GET(
      new Request("http://localhost/api/application-batches/preflight"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      scope: "NEW",
      eligibleCount: 100,
      eligibleTotal: 120,
      safeTotal: 120,
      maxJobs: 100,
      capped: true,
      activeBatch: {
        id: "batch-active",
        status: "RUNNING",
        totalCount: 100,
      },
    });
  });
});
