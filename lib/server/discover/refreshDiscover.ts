import type {
  TrendingResponse,
  VideoCategory,
  VideosResponse,
  VideoTimeWindow,
} from "@/app/(app)/discover/types";
import { reportError } from "@/lib/server/observability/errorReporter";
import { buildRepoCacheKey, writeDiscoverCache } from "./discoverCache";
import {
  fetchTrendingRepos,
  filterTrendingNoise,
} from "./githubTrending";
import { isQuotaExceededError } from "./videoCacheHelpers";
import { fetchVideosFromYouTube } from "./videoPipeline";

const CACHE_TTL_MS = 25 * 60 * 60 * 1_000;
const DEFAULT_VIDEO_CONCURRENCY = 2;

export const DAILY_VIDEO_TARGETS: ReadonlyArray<{
  category: VideoCategory;
  timeWindow: VideoTimeWindow;
}> = (() => {
  const categories: VideoCategory[] = [
    "all",
    "codex",
    "claude",
    "anthropic",
    "rag",
    "agents",
    "agent-skills",
    "harness-engineering",
  ];
  const windows: VideoTimeWindow[] = ["week", "month"];
  return categories.flatMap((category) =>
    windows.map((timeWindow) => ({ category, timeWindow })),
  );
})();

type RefreshTaskStatus = "ok" | "error" | "quota" | "skipped" | "timeout";

export interface DiscoverRefreshTaskResult {
  key: string;
  source: "github" | "youtube";
  status: RefreshTaskStatus;
  itemCount?: number;
}

export interface DiscoverRefreshSummary {
  status: "succeeded" | "partial" | "failed";
  startedAt: string;
  completedAt: string;
  counts: Record<RefreshTaskStatus, number>;
  results: DiscoverRefreshTaskResult[];
}

interface ExecuteDiscoverRefreshOptions {
  apiKey?: string;
  maxRuntimeMs: number;
  videoConcurrency?: number;
  videoTargets?: ReadonlyArray<{
    category: VideoCategory;
    timeWindow: VideoTimeWindow;
  }>;
}

function videoCacheKey(
  category: VideoCategory,
  timeWindow: VideoTimeWindow,
): string {
  return `videos:${category}:${timeWindow}`;
}

function summarize(
  startedAt: Date,
  completedAt: Date,
  results: DiscoverRefreshTaskResult[],
): DiscoverRefreshSummary {
  const counts: Record<RefreshTaskStatus, number> = {
    ok: 0,
    error: 0,
    quota: 0,
    skipped: 0,
    timeout: 0,
  };
  for (const result of results) counts[result.status] += 1;
  const status =
    counts.error + counts.quota + counts.skipped + counts.timeout === 0
      ? "succeeded"
      : counts.ok > 0
        ? "partial"
        : "failed";
  return {
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    counts,
    results,
  };
}

/**
 * Refreshes durable Discover caches within one serverless time budget.
 * GitHub runs first so a missing/exhausted YouTube integration cannot block
 * repository freshness. Every target is isolated and reports a stable status;
 * upstream error details stay in server observability only.
 */
export async function executeDiscoverRefresh(
  options: ExecuteDiscoverRefreshOptions,
): Promise<DiscoverRefreshSummary> {
  if (!Number.isSafeInteger(options.maxRuntimeMs) || options.maxRuntimeMs < 1) {
    throw new TypeError("Discover refresh runtime must be a positive integer");
  }
  const videoTargets = options.videoTargets ?? DAILY_VIDEO_TARGETS;
  const videoConcurrency = Math.max(
    1,
    Math.min(
      options.videoConcurrency ?? DEFAULT_VIDEO_CONCURRENCY,
      Math.max(1, videoTargets.length),
    ),
  );
  const startedAt = new Date();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Discover refresh deadline exceeded")),
    options.maxRuntimeMs,
  );
  const results: DiscoverRefreshTaskResult[] = [];

  try {
    for (const period of ["weekly", "monthly"] as const) {
      const key = buildRepoCacheKey(period, false);
      if (controller.signal.aborted) {
        results.push({ key, source: "github", status: "timeout" });
        continue;
      }
      try {
        const repos = await fetchTrendingRepos(period, {
          signal: controller.signal,
        });
        const cleanRepos = filterTrendingNoise(repos);
        const fetchedAt = new Date();
        const rawPayload: TrendingResponse = {
          repos,
          cached: false,
          fetchedAt: fetchedAt.toISOString(),
        };
        const cleanPayload: TrendingResponse = {
          repos: cleanRepos,
          cached: false,
          fetchedAt: fetchedAt.toISOString(),
        };
        await Promise.all([
          writeDiscoverCache(
            buildRepoCacheKey(period, false),
            rawPayload,
            CACHE_TTL_MS,
            fetchedAt,
          ),
          writeDiscoverCache(
            buildRepoCacheKey(period, true),
            cleanPayload,
            CACHE_TTL_MS,
            fetchedAt,
          ),
        ]);
        results.push({
          key,
          source: "github",
          status: "ok",
          itemCount: repos.length,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          results.push({ key, source: "github", status: "timeout" });
        } else {
          reportError(error, {
            scope: "discover.refresh-daily.github",
            tags: { period },
          });
          results.push({ key, source: "github", status: "error" });
        }
      }
    }

    if (!options.apiKey) {
      for (const { category, timeWindow } of videoTargets) {
        results.push({
          key: videoCacheKey(category, timeWindow),
          source: "youtube",
          status: "skipped",
        });
      }
      return summarize(startedAt, new Date(), results);
    }

    const videoResults: DiscoverRefreshTaskResult[] = new Array(
      videoTargets.length,
    );
    let nextIndex = 0;
    let quotaHit = false;

    const workers = Array.from({ length: videoConcurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= videoTargets.length) return;

        const { category, timeWindow } = videoTargets[index];
        const key = videoCacheKey(category, timeWindow);
        if (controller.signal.aborted) {
          videoResults[index] = {
            key,
            source: "youtube",
            status: "timeout",
          };
          continue;
        }
        if (quotaHit) {
          videoResults[index] = {
            key,
            source: "youtube",
            status: "quota",
          };
          continue;
        }

        try {
          const items = await fetchVideosFromYouTube(
            category,
            timeWindow,
            options.apiKey!,
            "trending",
            { signal: controller.signal },
          );
          if (items.length === 0) {
            throw new Error(
              `YouTube returned no videos for ${category}/${timeWindow}`,
            );
          }
          const fetchedAt = new Date();
          const payload: VideosResponse = {
            items,
            cached: false,
            fetchedAt: fetchedAt.toISOString(),
          };
          await writeDiscoverCache(
            key,
            payload,
            CACHE_TTL_MS,
            fetchedAt,
          );
          videoResults[index] = {
            key,
            source: "youtube",
            status: "ok",
            itemCount: items.length,
          };
        } catch (error) {
          if (controller.signal.aborted) {
            videoResults[index] = {
              key,
              source: "youtube",
              status: "timeout",
            };
          } else if (isQuotaExceededError(error)) {
            quotaHit = true;
            videoResults[index] = {
              key,
              source: "youtube",
              status: "quota",
            };
          } else {
            reportError(error, {
              scope: "discover.refresh-daily.youtube",
              tags: { category, timeWindow },
            });
            videoResults[index] = {
              key,
              source: "youtube",
              status: "error",
            };
          }
        }
      }
    });

    await Promise.all(workers);
    results.push(...videoResults);
    return summarize(startedAt, new Date(), results);
  } finally {
    clearTimeout(timeout);
  }
}
