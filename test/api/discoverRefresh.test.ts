import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/server/discover/discoverCache", () => ({
  claimDailyDiscoverRefresh: refreshMocks.claim,
  completeDailyDiscoverRefresh: refreshMocks.complete,
}));

vi.mock("@/lib/server/discover/refreshDiscover", () => ({
  executeDiscoverRefresh: refreshMocks.execute,
}));

import { GET } from "@/app/api/discover/refresh-daily/route";

describe("Discover daily cron route", () => {
  beforeEach(() => {
    for (const mock of Object.values(refreshMocks)) mock.mockReset();
    process.env.CRON_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.YOUTUBE_API_KEY = "youtube-key";
    refreshMocks.complete.mockResolvedValue(true);
  });

  it("fails closed when CRON_SECRET is absent", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(
      new Request("https://www.joblit.tech/api/discover/refresh-daily"),
    );

    expect(response.status).toBe(401);
    expect(refreshMocks.claim).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer without starting the refresh", async () => {
    const response = await GET(
      new Request("https://www.joblit.tech/api/discover/refresh-daily", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
    expect(refreshMocks.claim).not.toHaveBeenCalled();
  });

  it("returns the persisted result for a repeated same-day delivery", async () => {
    refreshMocks.claim.mockResolvedValue({
      claimed: false,
      runKey: "discover-refresh:2026-07-20",
      previous: { status: "succeeded", counts: { ok: 18 } },
    });

    const response = await GET(
      new Request("https://www.joblit.tech/api/discover/refresh-daily", {
        headers: {
          authorization:
            "Bearer 0123456789abcdef0123456789abcdef",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deduplicated).toBe(true);
    expect(body.previous.status).toBe("succeeded");
    expect(refreshMocks.execute).not.toHaveBeenCalled();
  });

  it("runs once with a valid Vercel bearer and persists the summary", async () => {
    refreshMocks.claim.mockResolvedValue({
      claimed: true,
      runKey: "discover-refresh:2026-07-20",
      ownerToken: "owner-1",
    });
    refreshMocks.execute.mockResolvedValue({
      status: "partial",
      counts: { ok: 17, error: 1, quota: 0, skipped: 0, timeout: 0 },
      results: [],
    });

    const response = await GET(
      new Request("https://www.joblit.tech/api/discover/refresh-daily", {
        headers: {
          authorization:
            "Bearer 0123456789abcdef0123456789abcdef",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(refreshMocks.claim).toHaveBeenCalledWith(
      expect.any(Date),
      90_000,
    );
    expect(refreshMocks.execute).toHaveBeenCalledWith({
      apiKey: "youtube-key",
      maxRuntimeMs: 48_000,
    });
    expect(refreshMocks.complete).toHaveBeenCalledWith(
      "discover-refresh:2026-07-20",
      "owner-1",
      expect.objectContaining({ status: "partial" }),
      expect.any(Date),
    );
  });

  it("rejects a stale owner after a replacement run acquires the lease", async () => {
    refreshMocks.claim.mockResolvedValue({
      claimed: true,
      runKey: "discover-refresh:2026-07-20",
      ownerToken: "expired-owner",
    });
    refreshMocks.execute.mockResolvedValue({
      status: "succeeded",
      counts: { ok: 18, error: 0, quota: 0, skipped: 0, timeout: 0 },
      results: [],
    });
    refreshMocks.complete.mockResolvedValue(false);

    const response = await GET(
      new Request("https://www.joblit.tech/api/discover/refresh-daily", {
        headers: {
          authorization:
            "Bearer 0123456789abcdef0123456789abcdef",
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "DISCOVER_REFRESH_LEASE_LOST",
    });
  });
});
