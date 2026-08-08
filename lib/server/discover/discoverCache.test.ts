import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    discoverCache: cacheStore,
  },
}));

import { isFresh, readDiscoverCache, writeDiscoverCache } from "./discoverCache";

describe("discover persistent cache", () => {
  beforeEach(() => {
    for (const mock of Object.values(cacheStore)) mock.mockReset();
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

  it("rejects a non-positive TTL instead of writing an already-dead row", async () => {
    await expect(
      writeDiscoverCache("repos:weekly:raw", { repos: [] }, 0),
    ).rejects.toThrow(TypeError);
    expect(cacheStore.upsert).not.toHaveBeenCalled();
  });

  it("treats the exact expiry tick as stale so fallover is deterministic", () => {
    const expiresAt = new Date("2026-07-21T07:00:00.000Z");
    expect(isFresh({ expiresAt }, expiresAt.getTime() - 1)).toBe(true);
    expect(isFresh({ expiresAt }, expiresAt.getTime())).toBe(false);
  });
});
