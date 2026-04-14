"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw, KeyRound, Star, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVideos } from "../hooks/useDiscoverData";
import {
  useFavoritedVideos,
  useWatchedVideos,
} from "../hooks/useVideoPreferences";
import type {
  VideoCategory,
  VideoSort,
  VideoTimeWindow,
  VideoItem,
} from "../types";
import { VideoCard } from "./VideoCard";
import { VideoSkeleton } from "./DiscoverSkeleton";

const CATEGORIES: { value: VideoCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "anthropic", label: "Anthropic" },
  { value: "rag", label: "RAG" },
  { value: "agents", label: "Agents" },
  { value: "agent-skills", label: "Agent Skills" },
  { value: "harness-engineering", label: "Harness engineering" },
];

const SORTS: { value: VideoSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "latest", label: "Latest" },
  { value: "most_viewed", label: "Most viewed" },
];

const TIME_WINDOWS: { value: VideoTimeWindow; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

const VALID_CATS = new Set<string>(CATEGORIES.map((c) => c.value));
const VALID_SORTS = new Set<string>(SORTS.map((s) => s.value));
const VALID_WINDOWS = new Set<string>(TIME_WINDOWS.map((w) => w.value));
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Comprehensive trending score combining engagement, freshness, authority,
 * expertise match, duration sweet-spot, and user signals.
 */
function trendingScore(v: VideoItem, category: VideoCategory): number {
  const daysOld = Math.max(
    0,
    (Date.now() - new Date(v.publishedAt).getTime()) / DAY_MS,
  );
  const freshness = Math.max(0, 1 - daysOld / 30);

  let score =
    Math.log(v.viewCount + 1) * 0.5 +
    Math.log(v.likeCount + 1) * 0.3 +
    freshness * 5 +
    v.relevanceScore * 2; // title+desc keyword overlap

  // Authority tiers (from curated trusted channels config)
  if (v.trustTier === 1) score += 2.5;
  else if (v.trustTier === 2) score += 1.2;
  else if (v.trustTier === 3) score += 0.4;

  // Channel matches category expertise
  if (category !== "all" && v.expertiseTags.includes(category)) {
    score += 0.8;
  }

  // Large audience signal
  if (v.channelSubscriberCount > 50_000) score += 0.6;

  // Duration sweet spot (5-30 min)
  if (v.durationSeconds >= 5 * 60 && v.durationSeconds <= 30 * 60) {
    score += 0.3;
  }

  return score;
}

function rankVideos(
  items: VideoItem[],
  sort: VideoSort,
  category: VideoCategory,
  watched: Set<string>,
): VideoItem[] {
  const base =
    sort === "latest"
      ? [...items].sort(
          (a, b) =>
            new Date(b.publishedAt).getTime() -
            new Date(a.publishedAt).getTime(),
        )
      : sort === "most_viewed"
        ? [...items].sort((a, b) => b.viewCount - a.viewCount)
        : [...items]
            .map((v) => ({ video: v, score: trendingScore(v, category) }))
            .sort((a, b) => b.score - a.score)
            .map((x) => x.video);

  // Watched videos sink to bottom (preserves relative order within each group)
  const unseen = base.filter((v) => !watched.has(v.id));
  const seen = base.filter((v) => watched.has(v.id));
  return [...unseen, ...seen];
}

const HEADING = (
  <h2 className="mb-4 flex items-center justify-between text-base font-semibold text-slate-900 lg:text-lg">
    <span>AI Videos</span>
  </h2>
);

export function VideoList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const favorites = useFavoritedVideos();
  const watched = useWatchedVideos();

  const initialCat = searchParams.get("cat");
  const initialSort = searchParams.get("sort");
  const initialWindow = searchParams.get("window");
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
  const [timeWindow, setTimeWindow] = useState<VideoTimeWindow>(
    initialWindow && VALID_WINDOWS.has(initialWindow)
      ? (initialWindow as VideoTimeWindow)
      : "month",
  );
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (category === "all") next.delete("cat");
    else next.set("cat", category);
    if (sort === "trending") next.delete("sort");
    else next.set("sort", sort);
    if (timeWindow === "month") next.delete("window");
    else next.set("window", timeWindow);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sort, timeWindow]);

  // Close inline player when switching category/sort/window/favorites
  useEffect(() => {
    setPlayingId(null);
  }, [category, sort, timeWindow, showFavoritesOnly]);

  const { data, isLoading, error } = useVideos(category, timeWindow);
  const rawItems = data?.items ?? [];
  const noApiKey = data?.noApiKey === true;

  const items = useMemo(() => {
    const ranked = rankVideos(rawItems, sort, category, watched.ids);
    return showFavoritesOnly
      ? ranked.filter((v) => favorites.has(v.id))
      : ranked;
  }, [rawItems, sort, category, watched.ids, favorites, showFavoritesOnly]);

  const favCount = favorites.ids.size;

  return (
    <section>
      {HEADING}

      {/* Category tabs */}
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

      {/* Time window pills */}
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
        <div className="inline-flex gap-0.5 rounded-lg bg-slate-100/80 p-0.5">
          {TIME_WINDOWS.map((w) => {
            const active = w.value === timeWindow;
            return (
              <button
                key={w.value}
                type="button"
                onClick={() => setTimeWindow(w.value)}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all sm:text-xs ${
                  active
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort pills + favorites filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-0.5 rounded-lg bg-slate-100/80 p-0.5">
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

        <button
          type="button"
          onClick={() => setShowFavoritesOnly((v) => !v)}
          aria-pressed={showFavoritesOnly}
          disabled={favCount === 0}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors sm:text-xs ${
            showFavoritesOnly
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          }`}
          title={
            favCount === 0
              ? "Star a video to add it here"
              : showFavoritesOnly
                ? "Show all"
                : "Show favorites only"
          }
        >
          <Star
            className={`h-3 w-3 ${
              showFavoritesOnly ? "fill-amber-400 text-amber-500" : ""
            }`}
          />
          {showFavoritesOnly ? "All" : `Favorites (${favCount})`}
        </button>
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
          {showFavoritesOnly
            ? "No favorites match this category. Switch category or hit the star on a video."
            : "No videos in this category yet. Try a different filter."}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {items.map((item) => (
            <VideoCard
              key={item.id}
              item={item}
              isWatched={watched.has(item.id)}
              isFavorited={favorites.has(item.id)}
              isPlaying={playingId === item.id}
              onPlay={setPlayingId}
              onClose={() => setPlayingId(null)}
              onToggleFavorite={favorites.toggle}
              onMarkWatched={watched.add}
            />
          ))}
        </div>
      )}
    </section>
  );
}
