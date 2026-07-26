import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  transaction: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: store.transaction },
}));

import { reconcileFetchedSourceJobLiveness } from "@/lib/server/jobs/sourceLivenessService";

describe("source-feed job liveness consumption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.updateMany.mockResolvedValue({ count: 1 });
    store.transaction.mockImplementation(async (action) =>
      action({ job: { updateMany: store.updateMany } }),
    );
  });

  it("marks missing active rows uncertain and restores observed rows active", async () => {
    const checkedAt = new Date("2026-07-20T00:00:00Z");
    await reconcileFetchedSourceJobLiveness({
      userId: "user-1",
      checkedAt,
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
      jobs: [
        {
          jobUrl: "https://example.com/jobs/1?utm_source=feed",
          title: "Platform Engineer",
          company: "Acme",
          location: null,
          jobType: null,
          jobLevel: null,
          description: null,
          salary: null,
          workArrangement: null,
          listingDate: null,
          source: "remoteok",
        },
      ],
    });

    expect(store.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          jobUrl: { in: ["https://example.com/jobs/1"] },
          OR: [
            { livenessCheckedAt: null },
            { livenessCheckedAt: { lt: checkedAt } },
          ],
        }),
        data: expect.objectContaining({
          livenessStatus: "ACTIVE",
          livenessReason: "source_feed_reachable",
          lastSeenAt: checkedAt,
        }),
      }),
    );
    expect(store.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        userId: "user-1",
        source: "remoteok",
        livenessStatus: "ACTIVE",
        OR: [
          { livenessCheckedAt: null },
          { livenessCheckedAt: { lt: checkedAt } },
        ],
      },
      data: {
        livenessStatus: "UNCERTAIN",
        livenessReason: "missing_from_source_feed",
        livenessCheckedAt: checkedAt,
      },
    });
    expect(store.transaction.mock.calls[0]?.[1]).toEqual({
      maxWait: 5_000,
      timeout: 30_000,
    });
  });

  it("ignores failed sources because an outage is not a job signal", async () => {
    await reconcileFetchedSourceJobLiveness({
      userId: "user-1",
      diagnostics: [
        { source: "remoteok", ok: false, raw: 0, error: "HTTP 503" },
      ],
      jobs: [],
    });

    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("does not let an older run revert a newer source snapshot", async () => {
    const newerAt = new Date("2026-07-20T00:00:00Z");
    const olderAt = new Date("2026-07-19T00:00:00Z");
    const row = {
      livenessStatus: "ACTIVE",
      livenessReason: null as string | null,
      livenessCheckedAt: null as Date | null,
      lastSeenAt: null as Date | null,
    };
    store.updateMany.mockImplementation(async ({ where, data }) => {
      const cutoff = where.OR?.find(
        (condition: { livenessCheckedAt?: { lt?: Date } }) =>
          condition.livenessCheckedAt?.lt,
      )?.livenessCheckedAt?.lt;
      if (
        cutoff &&
        row.livenessCheckedAt &&
        row.livenessCheckedAt >= cutoff
      ) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    });

    await reconcileFetchedSourceJobLiveness({
      userId: "user-1",
      checkedAt: newerAt,
      diagnostics: [{ source: "remoteok", ok: true, raw: 1 }],
      jobs: [
        {
          jobUrl: "https://example.com/jobs/1",
          title: "Platform Engineer",
          company: "Acme",
          location: null,
          jobType: null,
          jobLevel: null,
          description: null,
          salary: null,
          workArrangement: null,
          listingDate: null,
          source: "remoteok",
        },
      ],
    });
    await reconcileFetchedSourceJobLiveness({
      userId: "user-1",
      checkedAt: olderAt,
      diagnostics: [{ source: "remoteok", ok: true, raw: 0 }],
      jobs: [],
    });

    expect(row).toEqual({
      livenessStatus: "ACTIVE",
      livenessReason: "source_feed_reachable",
      livenessCheckedAt: newerAt,
      lastSeenAt: newerAt,
    });
  });
});
