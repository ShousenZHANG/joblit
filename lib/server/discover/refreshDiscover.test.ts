import { beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({
  fetchVideos: vi.fn(),
  fetchRepos: vi.fn(),
  writeCache: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("./videoPipeline", () => ({
  fetchVideosFromYouTube: upstream.fetchVideos,
}));

vi.mock("./githubTrending", () => ({
  fetchTrendingRepos: upstream.fetchRepos,
  filterTrendingNoise: (repos: Array<{ fullName: string }>) =>
    repos.filter((repo) => !repo.fullName.includes("noise")),
}));

vi.mock("./discoverCache", () => ({
  buildRepoCacheKey: (period: string, clean: boolean) =>
    `repos:${period}:${clean ? "clean" : "raw"}`,
  writeDiscoverCache: upstream.writeCache,
}));

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: upstream.reportError,
}));

import { executeDiscoverRefresh } from "./refreshDiscover";

const VIDEO_TARGETS = [
  { category: "all" as const, timeWindow: "week" as const },
  { category: "codex" as const, timeWindow: "month" as const },
];

describe("daily Discover refresh orchestration", () => {
  beforeEach(() => {
    for (const mock of Object.values(upstream)) mock.mockReset();
    upstream.writeCache.mockResolvedValue(undefined);
  });

  it("persists weekly/monthly raw and clean repos before refreshing videos", async () => {
    upstream.fetchRepos
      .mockResolvedValueOnce([
        { fullName: "openai/codex" },
        { fullName: "noise/roadmap" },
      ])
      .mockResolvedValueOnce([{ fullName: "vercel/next.js" }]);
    upstream.fetchVideos.mockResolvedValue([{ id: "video-1" }]);

    const summary = await executeDiscoverRefresh({
      apiKey: "youtube-key",
      videoTargets: VIDEO_TARGETS,
      maxRuntimeMs: 20_000,
    });

    expect(upstream.fetchRepos).toHaveBeenCalledTimes(2);
    expect(upstream.writeCache).toHaveBeenCalledWith(
      "repos:weekly:raw",
      expect.objectContaining({
        repos: [
          { fullName: "openai/codex" },
          { fullName: "noise/roadmap" },
        ],
      }),
      expect.any(Number),
      expect.any(Date),
    );
    expect(upstream.writeCache).toHaveBeenCalledWith(
      "repos:weekly:clean",
      expect.objectContaining({ repos: [{ fullName: "openai/codex" }] }),
      expect.any(Number),
      expect.any(Date),
    );
    expect(upstream.writeCache).toHaveBeenCalledWith(
      "repos:monthly:raw",
      expect.any(Object),
      expect.any(Number),
      expect.any(Date),
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.counts.ok).toBe(4);
  });

  it("still refreshes GitHub when YOUTUBE_API_KEY is missing", async () => {
    upstream.fetchRepos.mockResolvedValue([{ fullName: "openai/codex" }]);

    const summary = await executeDiscoverRefresh({
      videoTargets: VIDEO_TARGETS,
      maxRuntimeMs: 20_000,
    });

    expect(upstream.fetchRepos).toHaveBeenCalledTimes(2);
    expect(upstream.fetchVideos).not.toHaveBeenCalled();
    expect(summary.counts.ok).toBe(2);
    expect(summary.counts.skipped).toBe(2);
    expect(summary.status).toBe("partial");
  });

  it("isolates one upstream failure so later repo and video targets continue", async () => {
    upstream.fetchRepos
      .mockRejectedValueOnce(new Error("weekly down"))
      .mockResolvedValueOnce([{ fullName: "vercel/next.js" }]);
    upstream.fetchVideos
      .mockRejectedValueOnce(new Error("one video target failed"))
      .mockResolvedValueOnce([{ id: "video-2" }]);

    const summary = await executeDiscoverRefresh({
      apiKey: "youtube-key",
      videoTargets: VIDEO_TARGETS,
      maxRuntimeMs: 20_000,
    });

    expect(upstream.fetchRepos).toHaveBeenCalledTimes(2);
    expect(upstream.fetchVideos).toHaveBeenCalledTimes(2);
    expect(summary.counts.ok).toBe(2);
    expect(summary.counts.error).toBe(2);
    expect(summary.status).toBe("partial");
    expect(upstream.reportError).toHaveBeenCalledTimes(2);
  });

  it("stops starting new video targets after YouTube quota is exhausted", async () => {
    upstream.fetchRepos.mockResolvedValue([{ fullName: "openai/codex" }]);
    upstream.fetchVideos.mockRejectedValue({ status: 403 });

    const summary = await executeDiscoverRefresh({
      apiKey: "youtube-key",
      videoTargets: [
        ...VIDEO_TARGETS,
        { category: "agents" as const, timeWindow: "week" as const },
      ],
      videoConcurrency: 1,
      maxRuntimeMs: 20_000,
    });

    expect(upstream.fetchVideos).toHaveBeenCalledTimes(1);
    expect(summary.counts.quota).toBe(3);
    expect(summary.status).toBe("partial");
  });

  it("does not overwrite last-known-good when a YouTube target returns no items", async () => {
    upstream.fetchRepos.mockResolvedValue([{ fullName: "openai/codex" }]);
    upstream.fetchVideos.mockResolvedValue([]);

    const summary = await executeDiscoverRefresh({
      apiKey: "youtube-key",
      videoTargets: [VIDEO_TARGETS[0]],
      maxRuntimeMs: 20_000,
    });

    expect(summary.counts.error).toBe(1);
    expect(summary.status).toBe("partial");
    expect(upstream.writeCache).not.toHaveBeenCalledWith(
      "videos:all:week",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(upstream.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "YouTube returned no videos for all/week",
      }),
      expect.objectContaining({
        scope: "discover.refresh-daily.youtube",
      }),
    );
  });
});
