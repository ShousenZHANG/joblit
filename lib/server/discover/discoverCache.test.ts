import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheStore = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    discoverVideoCache: cacheStore,
  },
}));

import {
  claimDailyDiscoverRefresh,
  completeDailyDiscoverRefresh,
  readDiscoverCache,
  writeDiscoverCache,
} from "./discoverCache";

describe("discover persistent cache", () => {
  beforeEach(() => {
    for (const mock of Object.values(cacheStore)) mock.mockReset();
    cacheStore.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("round-trips a namespaced JSON payload with timestamps", async () => {
    cacheStore.findUnique.mockResolvedValue({
      key: "repos:weekly:raw",
      payload: { repos: [{ fullName: "openai/codex" }] },
      fetchedAt: new Date("2026-07-20T06:00:00.000Z"),
      expiresAt: new Date("2026-07-21T07:00:00.000Z"),
    });

    const entry = await readDiscoverCache<{ repos: Array<{ fullName: string }> }>(
      "repos:weekly:raw",
    );

    expect(entry?.payload.repos[0].fullName).toBe("openai/codex");
    expect(entry?.fetchedAt.toISOString()).toBe("2026-07-20T06:00:00.000Z");
  });

  it("upserts content with one server timestamp and the requested TTL", async () => {
    cacheStore.upsert.mockResolvedValue({});

    await writeDiscoverCache(
      "repos:monthly:clean",
      { repos: [] },
      25 * 60 * 60 * 1_000,
      new Date("2026-07-20T06:00:00.000Z"),
    );

    expect(cacheStore.upsert).toHaveBeenCalledWith({
      where: { key: "repos:monthly:clean" },
      create: {
        key: "repos:monthly:clean",
        payload: { repos: [] },
        fetchedAt: new Date("2026-07-20T06:00:00.000Z"),
        expiresAt: new Date("2026-07-21T07:00:00.000Z"),
      },
      update: {
        payload: { repos: [] },
        fetchedAt: new Date("2026-07-20T06:00:00.000Z"),
        expiresAt: new Date("2026-07-21T07:00:00.000Z"),
      },
    });
  });
});

describe("daily Discover refresh lease", () => {
  beforeEach(() => {
    for (const mock of Object.values(cacheStore)) mock.mockReset();
    cacheStore.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("atomically claims the UTC-day run before any upstream work", async () => {
    cacheStore.create.mockResolvedValue({});

    const claim = await claimDailyDiscoverRefresh(
      new Date("2026-07-20T06:00:00.000Z"),
      55_000,
    );

    expect(claim).toEqual({
      claimed: true,
      runKey: "discover-refresh:2026-07-20",
      ownerToken: expect.any(String),
    });
    expect(cacheStore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "discover-refresh:2026-07-20",
        payload: expect.objectContaining({
          status: "running",
          ownerToken: expect.any(String),
        }),
        expiresAt: new Date("2026-07-20T06:00:55.000Z"),
      }),
    });
  });

  it("deduplicates a repeated delivery while its lease or result is live", async () => {
    cacheStore.create.mockRejectedValue({ code: "P2002" });
    cacheStore.updateMany.mockResolvedValue({ count: 0 });
    cacheStore.findUnique.mockResolvedValue({
      key: "discover-refresh:2026-07-20",
      payload: { status: "succeeded", ok: 20 },
      fetchedAt: new Date("2026-07-20T06:00:30.000Z"),
      expiresAt: new Date("2026-07-27T06:00:30.000Z"),
    });

    const claim = await claimDailyDiscoverRefresh(
      new Date("2026-07-20T06:01:00.000Z"),
      55_000,
    );

    expect(claim).toEqual({
      claimed: false,
      runKey: "discover-refresh:2026-07-20",
      previous: { status: "succeeded", ok: 20 },
    });
  });

  it("reclaims a crashed run only after the atomic lease expires", async () => {
    cacheStore.create.mockRejectedValue({ code: "P2002" });
    cacheStore.updateMany.mockResolvedValue({ count: 1 });

    const claim = await claimDailyDiscoverRefresh(
      new Date("2026-07-20T06:02:00.000Z"),
      55_000,
    );

    expect(claim.claimed).toBe(true);
    expect(cacheStore.updateMany).toHaveBeenCalledWith({
      where: {
        key: "discover-refresh:2026-07-20",
        expiresAt: { lte: new Date("2026-07-20T06:02:00.000Z") },
      },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          status: "running",
          ownerToken: expect.any(String),
        }),
        expiresAt: new Date("2026-07-20T06:02:55.000Z"),
      }),
    });
  });

  it("persists the final summary only for the current lease owner", async () => {
    cacheStore.updateMany.mockResolvedValue({ count: 1 });

    const completed = await completeDailyDiscoverRefresh(
      "discover-refresh:2026-07-20",
      "owner-2",
      { status: "partial", ok: 17, error: 1 },
      new Date("2026-07-20T06:00:40.000Z"),
    );

    expect(completed).toBe(true);
    expect(cacheStore.updateMany).toHaveBeenCalledWith({
      where: {
        key: "discover-refresh:2026-07-20",
        payload: {
          path: ["ownerToken"],
          equals: "owner-2",
        },
      },
      data: {
        payload: { status: "partial", ok: 17, error: 1 },
        fetchedAt: new Date("2026-07-20T06:00:40.000Z"),
        expiresAt: new Date("2026-07-27T06:00:40.000Z"),
      },
    });
  });

  it("fences an expired owner from overwriting a replacement run", async () => {
    cacheStore.updateMany.mockResolvedValue({ count: 0 });

    const completed = await completeDailyDiscoverRefresh(
      "discover-refresh:2026-07-20",
      "expired-owner",
      { status: "succeeded" },
      new Date("2026-07-20T06:02:10.000Z"),
    );

    expect(completed).toBe(false);
  });
});
