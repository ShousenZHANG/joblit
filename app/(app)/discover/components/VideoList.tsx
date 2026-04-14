"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVideos } from "../hooks/useDiscoverData";
import type { VideoCategory, VideoSort, VideoItem } from "../types";
import { VideoCard } from "./VideoCard";
import { VideoSkeleton } from "./DiscoverSkeleton";

const CATEGORIES: { value: VideoCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "anthropic", label: "Anthropic" },
  { value: "rag", label: "RAG" },
  { value: "agents", label: "Agents" },
  { value: "mcp", label: "MCP" },
  { value: "harness", label: "Harness" },
];

const SORTS: { value: VideoSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "latest", label: "Latest" },
  { value: "most_viewed", label: "Most viewed" },
];

const VALID_CATS = new Set<string>(CATEGORIES.map((c) => c.value));
const VALID_SORTS = new Set<string>(SORTS.map((s) => s.value));

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Client-side scoring/sorting. The backend caches one candidate pool per
 * category; switching sort never re-fetches.
 */
function rankVideos(items: VideoItem[], sort: VideoSort): VideoItem[] {
  if (sort === "latest") {
    return [...items]
      .filter((v) => Date.now() - new Date(v.publishedAt).getTime() < 7 * DAY_MS)
      .sort(
        (a, b) =>
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
  }
  if (sort === "most_viewed") {
    return [...items].sort((a, b) => b.viewCount - a.viewCount);
  }
  // trending
  return [...items]
    .map((v) => ({ video: v, score: trendingScore(v) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.video);
}

function trendingScore(v: VideoItem): number {
  const daysOld = Math.max(
    0,
    (Date.now() - new Date(v.publishedAt).getTime()) / DAY_MS,
  );
  const freshness = Math.max(0, 1 - daysOld / 30);
  let score =
    Math.log(v.viewCount + 1) * 0.5 +
    Math.log(v.likeCount + 1) * 0.3 +
    freshness * 5; // weight freshness comparably with log(views)

  if (v.isTrusted) score += 1.5;
  if (v.channelSubscriberCount > 50_000) score += 1.0;
  if (v.durationSeconds >= 5 * 60 && v.durationSeconds <= 30 * 60) score += 0.5;
  return score;
}

const HEADING = (
  <h2 className="mb-4 text-base font-semibold text-slate-900 lg:text-lg">
    AI Videos
  </h2>
);

export function VideoList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const initialCat = searchParams.get("cat");
  const initialSort = searchParams.get("sort");
  const [category, setCategory] = useState<VideoCategory>(
    initialCat && VALID_CATS.has(initialCat)
      ? (initialCat as VideoCategory)
      : "all",
  );
  const [sort, setSort] = useState<VideoSort>(
    initialSort && VALID_SORTS.has(initialSort)
      ? (initialSort as VideoSort)
      : "trending",
  );

  // Sync state → URL (without scroll, replace not push to avoid history pollution)
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (category === "all") next.delete("cat");
    else next.set("cat", category);
    if (sort === "trending") next.delete("sort");
    else next.set("sort", sort);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sort]);

  const { data, isLoading, error } = useVideos(category);
  const rawItems = data?.items ?? [];
  const noApiKey = data?.noApiKey === true;

  const items = useMemo(() => rankVideos(rawItems, sort), [rawItems, sort]);

  return (
    <section>
      {HEADING}

      {/* Category tabs — horizontal scroll on mobile */}
      <div
        role="tablist"
        aria-label="Video categories"
        className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {CATEGORIES.map((c) => {
          const active = c.value === category;
          return (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(c.value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Sort pills */}
      <div className="mb-4 inline-flex gap-0.5 rounded-lg bg-slate-100/80 p-0.5">
        {SORTS.map((s) => {
          const active = s.value === sort;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setSort(s.value)}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all sm:text-xs ${
                active
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {noApiKey && !isLoading ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <KeyRound className="h-5 w-5 text-amber-500" />
          <p className="text-sm font-medium text-amber-700">
            YouTube API key required
          </p>
          <p className="text-xs text-amber-600">
            Add{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
              YOUTUBE_API_KEY
            </code>{" "}
            to Vercel environment variables. Free tier: 10,000 units/day.
          </p>
        </div>
      ) : isLoading ? (
        <VideoSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="h-5 w-5 text-rose-500" />
          <p className="text-sm text-rose-700">
            {error instanceof Error ? error.message : "Failed to load videos"}
          </p>
          <button
            type="button"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["discover-videos"] })
            }
            className="flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-200"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No videos in this category yet. Try a different filter.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {items.map((item) => (
            <VideoCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
