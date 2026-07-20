import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  getServerSession: vi.fn(),
}));

const pipelineMock = vi.hoisted(() => ({
  fetchVideosFromYouTube: vi.fn(),
}));

const cacheMock = vi.hoisted(() => ({
  buildCacheKey: vi.fn(
    (category: string, timeWindow: string, sort = "trending") => {
      const base = `videos:${category}:${timeWindow}`;
      return sort === "trending" ? base : `${base}:${sort}`;
    },
  ),
  isFresh: vi.fn(),
  isQuotaExceededError: vi.fn((err: unknown) => {
    if (!err || typeof err !== "object" || !("status" in err)) return false;
    return (err as { status?: number }).status === 403;
  }),
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

const errorReporterMock = vi.hoisted(() => ({
  reportError: vi.fn(),
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: sessionMock.getServerSession,
}));

vi.mock("@/lib/server/discover/videoPipeline", () => ({
  fetchVideosFromYouTube: pipelineMock.fetchVideosFromYouTube,
}));

vi.mock("@/lib/server/discover/videoCache", () => ({
  buildCacheKey: cacheMock.buildCacheKey,
  isFresh: cacheMock.isFresh,
  isQuotaExceededError: cacheMock.isQuotaExceededError,
  readCache: cacheMock.readCache,
  writeCache: cacheMock.writeCache,
}));

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: errorReporterMock.reportError,
}));

import { GET } from "@/app/api/discover/videos/route";
import type { VideoItem } from "@/app/(app)/discover/types";

function makeVideo(id: string, overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id,
    title: `Video ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnailUrl: "",
    channelName: "OpenAI",
    channelId: "UCXZCJLdBC09xxGZ6gcdrc6A",
    channelSubscriberCount: 1_000_000,
    isTrusted: true,
    trustTier: 1,
    expertiseTags: ["codex"],
    viewCount: 1_000,
    likeCount: 100,
    publishedAt: "2026-05-01T00:00:00.000Z",
    description: "OpenAI Codex coding agent tutorial",
    durationSeconds: 600,
    relevanceScore: 1,
    ...overrides,
  };
}

function mockAuthedUser() {
  sessionMock.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
}

describe("discover videos api", () => {
  beforeEach(() => {
    sessionMock.getServerSession.mockReset();
    pipelineMock.fetchVideosFromYouTube.mockReset();
    cacheMock.buildCacheKey.mockClear();
    cacheMock.isFresh.mockReset();
    cacheMock.isQuotaExceededError.mockClear();
    cacheMock.readCache.mockReset();
    cacheMock.readCache.mockResolvedValue(null);
    cacheMock.writeCache.mockReset();
    errorReporterMock.reportError.mockReset();
    cacheMock.writeCache.mockResolvedValue(undefined);
    process.env.YOUTUBE_API_KEY = "youtube-key";
  });

  it("requires an authenticated session", async () => {
    sessionMock.getServerSession.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/discover/videos?category=codex"),
    );

    expect(res.status).toBe(401);
    expect(pipelineMock.fetchVideosFromYouTube).not.toHaveBeenCalled();
  });

  it("returns an actionable empty response when YouTube API key is missing", async () => {
    mockAuthedUser();
    delete process.env.YOUTUBE_API_KEY;

    const res = await GET(
      new Request("http://localhost/api/discover/videos?category=codex"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.noApiKey).toBe(true);
    expect(json.items).toEqual([]);
  });

  it("serves stale last-known-good cache when YouTube API key is missing", async () => {
    mockAuthedUser();
    delete process.env.YOUTUBE_API_KEY;
    cacheMock.readCache.mockResolvedValueOnce({
      key: "videos:codex:month",
      payload: {
        items: [makeVideo("cached")],
        cached: false,
        fetchedAt: "2026-05-01T00:00:00.000Z",
      },
      fetchedAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    cacheMock.isFresh.mockReturnValueOnce(false);

    const res = await GET(
      new Request(
        "http://localhost/api/discover/videos?category=codex&window=month",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items[0].id).toBe("cached");
    expect(json.cached).toBe(true);
    expect(json.stale).toBe(true);
    expect(json.noApiKey).toBe(true);
    expect(pipelineMock.fetchVideosFromYouTube).not.toHaveBeenCalled();
  });

  it("passes Codex and most-viewed sorting into the fetch pipeline and cache key", async () => {
    mockAuthedUser();
    cacheMock.readCache.mockResolvedValueOnce(null);
    pipelineMock.fetchVideosFromYouTube.mockResolvedValueOnce([
      makeVideo("popular", { viewCount: 500_000 }),
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/discover/videos?category=codex&window=month&sort=most_viewed",
      ),
    );

    expect(res.status).toBe(200);
    expect(pipelineMock.fetchVideosFromYouTube).toHaveBeenCalledWith(
      "codex",
      "month",
      "youtube-key",
      "most_viewed",
    );
    expect(cacheMock.readCache).toHaveBeenCalledWith(
      "videos:codex:month:most_viewed",
    );
    expect(cacheMock.writeCache).toHaveBeenCalledWith(
      "videos:codex:month:most_viewed",
      expect.objectContaining({ items: expect.any(Array), cached: false }),
      expect.any(Number),
    );
  });

  it("serves sort-specific cache without re-hitting YouTube", async () => {
    mockAuthedUser();
    cacheMock.readCache.mockResolvedValueOnce({
      key: "videos:codex:month:most_viewed",
      payload: {
        items: [makeVideo("cached")],
        cached: false,
        fetchedAt: "2026-05-01T00:00:00.000Z",
      },
      fetchedAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    cacheMock.isFresh.mockReturnValueOnce(true);

    const res = await GET(
      new Request(
        "http://localhost/api/discover/videos?category=codex&window=month&sort=most_viewed",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cached).toBe(true);
    expect(json.fetchedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(pipelineMock.fetchVideosFromYouTube).not.toHaveBeenCalled();
  });

  it("falls back to default category cache when alternate-sort fetch hits quota", async () => {
    mockAuthedUser();
    cacheMock.readCache
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        key: "videos:codex:month",
        payload: {
          items: [
            makeVideo("low", { viewCount: 10 }),
            makeVideo("high", { viewCount: 20_000 }),
          ],
          cached: false,
          fetchedAt: "2026-05-01T00:00:00.000Z",
        },
        fetchedAt: new Date("2026-05-02T00:00:00.000Z"),
        expiresAt: new Date("2026-05-03T00:00:00.000Z"),
      });
    pipelineMock.fetchVideosFromYouTube.mockRejectedValueOnce({ status: 403 });

    const res = await GET(
      new Request(
        "http://localhost/api/discover/videos?category=codex&window=month&sort=most_viewed",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.stale).toBe(true);
    expect(json.cached).toBe(true);
    expect(json.items.map((item: VideoItem) => item.id)).toEqual([
      "high",
      "low",
    ]);
    expect(cacheMock.readCache).toHaveBeenNthCalledWith(
      2,
      "videos:codex:month",
    );
  });

  it("serves existing stale cache on a non-quota upstream failure and reports it", async () => {
    mockAuthedUser();
    const upstreamError = new Error("YouTube network failed");
    cacheMock.readCache.mockResolvedValueOnce({
      key: "videos:codex:month",
      payload: {
        items: [makeVideo("stale")],
        cached: false,
        fetchedAt: "2026-05-01T00:00:00.000Z",
      },
      fetchedAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    cacheMock.isFresh.mockReturnValueOnce(false);
    pipelineMock.fetchVideosFromYouTube.mockRejectedValueOnce(upstreamError);

    const res = await GET(
      new Request(
        "http://localhost/api/discover/videos?category=codex&window=month",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items[0].id).toBe("stale");
    expect(json.cached).toBe(true);
    expect(json.stale).toBe(true);
    expect(errorReporterMock.reportError).toHaveBeenCalledWith(upstreamError, {
      scope: "discover.videos",
    });
  });

  it("uses default LKG for alternate sort on a non-quota upstream failure", async () => {
    mockAuthedUser();
    const upstreamError = new Error("YouTube unavailable");
    cacheMock.readCache
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        key: "videos:codex:month",
        payload: {
          items: [
            makeVideo("old", {
              publishedAt: "2026-05-01T00:00:00.000Z",
            }),
            makeVideo("new", {
              publishedAt: "2026-05-03T00:00:00.000Z",
            }),
          ],
          cached: false,
          fetchedAt: "2026-05-01T00:00:00.000Z",
        },
        fetchedAt: new Date("2026-05-02T00:00:00.000Z"),
        expiresAt: new Date("2026-05-03T00:00:00.000Z"),
      });
    pipelineMock.fetchVideosFromYouTube.mockRejectedValueOnce(upstreamError);

    const res = await GET(
      new Request(
        "http://localhost/api/discover/videos?category=codex&window=month&sort=latest",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items.map((item: VideoItem) => item.id)).toEqual([
      "new",
      "old",
    ]);
    expect(json.stale).toBe(true);
    expect(errorReporterMock.reportError).toHaveBeenCalledWith(upstreamError, {
      scope: "discover.videos",
    });
  });
});
