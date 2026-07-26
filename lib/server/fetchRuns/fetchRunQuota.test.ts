import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/lib/generated/prisma";
import {
  FETCH_RUN_QUOTA_LIMITS,
  checkFetchRunQuota,
  fetchRunQuotaExceededResponse,
} from "./fetchRunQuota";

function fakeTransaction(counts: number[]) {
  const order: string[] = [];
  const remaining = [...counts];
  const executeRaw = vi.fn(async (_query: TemplateStringsArray, ..._values: unknown[]) => {
    order.push("lock");
    return 1;
  });
  const count = vi.fn(async () => {
    order.push("count");
    return remaining.shift() ?? 0;
  });

  return {
    tx: {
      $executeRaw: executeRaw,
      fetchRun: { count },
    } as unknown as Prisma.TransactionClient,
    order,
    executeRaw,
    count,
  };
}

describe("fetch run quota", () => {
  it("allows create when all persistent counts are under their limits", async () => {
    const { tx, count } = fakeTransaction([1, 19, 5, 119]);

    await expect(checkFetchRunQuota(tx, "user-1", "create")).resolves.toBeNull();
    expect(count).toHaveBeenCalledTimes(4);
  });

  it("blocks create when the user active count is at the limit", async () => {
    const { tx } = fakeTransaction([2, 0, 0, 0]);

    await expect(checkFetchRunQuota(tx, "user-1", "create")).resolves.toEqual({
      reason: "USER_ACTIVE_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.userActive,
      retryAfter: 30,
    });
  });

  it("allows trigger when active counts equal their limits", async () => {
    const { tx } = fakeTransaction([2, 20, 5, 119]);

    await expect(checkFetchRunQuota(tx, "user-1", "trigger")).resolves.toBeNull();
  });

  it("blocks trigger when the global active count is over the limit", async () => {
    const { tx } = fakeTransaction([2, 21, 5, 119]);

    await expect(checkFetchRunQuota(tx, "user-1", "trigger")).resolves.toEqual({
      reason: "GLOBAL_ACTIVE_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.globalActive,
      retryAfter: 30,
    });
  });

  it("treats stale reactivation as new active capacity", async () => {
    const { tx } = fakeTransaction([2, 20, 6, 120]);

    await expect(
      checkFetchRunQuota(tx, "user-1", "reactivate"),
    ).resolves.toEqual({
      reason: "USER_ACTIVE_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.userActive,
      retryAfter: 30,
    });
  });

  it("does not double-count the existing row against hourly reactivation", async () => {
    const { tx } = fakeTransaction([1, 1, 6, 120]);

    await expect(
      checkFetchRunQuota(tx, "user-1", "reactivate"),
    ).resolves.toBeNull();
  });

  it("blocks create when the user hourly count is at the limit", async () => {
    const { tx } = fakeTransaction([0, 0, 6, 0]);

    await expect(checkFetchRunQuota(tx, "user-1", "create")).resolves.toEqual({
      reason: "USER_HOURLY_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.userHourly,
      retryAfter: 3600,
    });
  });

  it("blocks create when the global hourly count is at the limit", async () => {
    const { tx } = fakeTransaction([0, 0, 5, 120]);

    await expect(checkFetchRunQuota(tx, "user-1", "create")).resolves.toEqual({
      reason: "GLOBAL_HOURLY_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.globalHourly,
      retryAfter: 3600,
    });
  });

  it("acquires the transaction advisory lock before reading any counts", async () => {
    const { tx, order, executeRaw } = fakeTransaction([0, 0, 0, 0]);

    await checkFetchRunQuota(tx, "user-1", "create");

    expect(order).toEqual(["lock", "count", "count", "count", "count"]);
    expect(String(executeRaw.mock.calls[0]?.[0])).toContain("pg_advisory_xact_lock");
  });

  it("excludes stale active rows without mutating outside the lifecycle lock", async () => {
    const { tx, count } = fakeTransaction([0, 0, 0, 0]);
    const now = new Date("2026-07-20T03:00:00.000Z");

    await checkFetchRunQuota(tx, "user-1", "create", now);

    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        status: { in: ["QUEUED", "RUNNING"] },
        updatedAt: { gte: new Date("2026-07-20T02:30:00.000Z") },
      },
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: {
        status: { in: ["QUEUED", "RUNNING"] },
        updatedAt: { gte: new Date("2026-07-20T02:30:00.000Z") },
      },
    });
  });

  it("returns the stable structured 429 response", async () => {
    const response = fetchRunQuotaExceededResponse({
      reason: "USER_ACTIVE_LIMIT",
      limit: 2,
      retryAfter: 30,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FETCH_RUN_QUOTA_EXCEEDED",
        message: "Free fetch capacity is busy right now. Try again shortly.",
        reason: "USER_ACTIVE_LIMIT",
        limit: 2,
      },
    });
  });
});
