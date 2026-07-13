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
  const queryRaw = vi.fn(async (_query: TemplateStringsArray, ..._values: unknown[]) => {
    order.push("lock");
    return [{ pg_advisory_xact_lock: null }];
  });
  const count = vi.fn(async () => {
    order.push("count");
    return remaining.shift() ?? 0;
  });

  return {
    tx: {
      $queryRaw: queryRaw,
      fetchRun: { count },
    } as unknown as Prisma.TransactionClient,
    order,
    queryRaw,
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
    const { tx, order, queryRaw } = fakeTransaction([0, 0, 0, 0]);

    await checkFetchRunQuota(tx, "user-1", "create");

    expect(order).toEqual(["lock", "count", "count", "count", "count"]);
    expect(String(queryRaw.mock.calls[0]?.[0])).toContain("pg_advisory_xact_lock");
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
