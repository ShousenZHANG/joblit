import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: store.transaction,
  },
}));

import { persistSourceHealthDiagnostics } from "@/lib/server/sources/sourceHealthStore";

describe("source health store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.transaction.mockImplementation(async (action) =>
      action({
        sourceHealth: {
          findMany: store.findMany,
          upsert: store.upsert,
        },
        $executeRaw: store.executeRaw,
      }),
    );
    store.upsert.mockResolvedValue({});
    store.executeRaw.mockResolvedValue(1);
    store.findMany.mockResolvedValue([]);
  });

  it("increments a failure streak into DOWN", async () => {
    store.findMany.mockResolvedValue([{
      source: "remoteok",
      status: "DEGRADED",
      consecutiveFailures: 2,
      lastCheckedAt: new Date("2026-07-19T00:00:00Z"),
      lastReachableAt: new Date("2026-07-18T00:00:00Z"),
      lastFailureAt: new Date("2026-07-19T00:00:00Z"),
      reason: "network",
    }]);

    await persistSourceHealthDiagnostics(
      [{ source: "remoteok", ok: false, raw: 0, error: "HTTP 503" }],
      new Date("2026-07-20T00:00:00Z"),
    );

    expect(store.upsert).toHaveBeenCalledWith({
      where: { source: "remoteok" },
      create: expect.objectContaining({
        source: "remoteok",
        status: "DOWN",
        consecutiveFailures: 3,
        reason: "network",
      }),
      update: expect.objectContaining({
        status: "DOWN",
        consecutiveFailures: 3,
        reason: "network",
      }),
    });
    expect(store.executeRaw).toHaveBeenCalledTimes(1);
    expect(store.findMany).toHaveBeenCalledTimes(1);
  });

  it("resets failures when a source is reachable but empty", async () => {
    store.findMany.mockResolvedValue([{
      source: "remoteok",
      status: "DOWN",
      consecutiveFailures: 4,
      lastCheckedAt: new Date("2026-07-19T00:00:00Z"),
      lastReachableAt: null,
      lastFailureAt: new Date("2026-07-19T00:00:00Z"),
      reason: "slug_gone",
    }]);

    await persistSourceHealthDiagnostics(
      [{ source: "remoteok", ok: true, raw: 0 }],
      new Date("2026-07-20T00:00:00Z"),
    );

    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "HEALTHY",
          consecutiveFailures: 0,
          reason: "empty",
          lastReachableAt: new Date("2026-07-20T00:00:00Z"),
        }),
      }),
    );
  });

  it("does not open a transaction without diagnostics", async () => {
    await persistSourceHealthDiagnostics([]);
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("locks and reads all sources in one roundtrip before updating them", async () => {
    await persistSourceHealthDiagnostics(
      [
        { source: "remoteok", ok: true, raw: 1 },
        { source: "jobicy", ok: false, raw: 0, error: "timeout" },
      ],
      new Date("2026-07-20T00:00:00Z"),
    );

    expect(store.executeRaw).toHaveBeenCalledTimes(1);
    expect(store.findMany).toHaveBeenCalledTimes(1);
    expect(store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: { in: ["jobicy", "remoteok"] } },
      }),
    );
    expect(store.upsert).toHaveBeenCalledTimes(2);
    expect(store.transaction.mock.calls[0]?.[1]).toEqual({
      maxWait: 5_000,
      timeout: 30_000,
    });
  });
});
