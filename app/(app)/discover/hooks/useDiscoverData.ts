import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  TrendingResponse,
  VideosResponse,
  VideoCategory,
  VideoSort,
  VideoTimeWindow,
} from "../types";

export function useTrendingRepos(
  period: "weekly" | "monthly" = "weekly",
  clean = false,
) {
  return useQuery<TrendingResponse>({
    queryKey: ["discover-trending", period, clean],
    queryFn: async () => {
      const res = await fetch(
        `/api/discover/trending?period=${period}${clean ? "&clean=1" : ""}`,
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to load trending repos");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Hold the previous period's grid in place while the new one loads, so a
    // weekly/monthly switch dims rather than collapsing back to a skeleton.
    placeholderData: keepPreviousData,
  });
}

/** Fetch videos for a category, time window, and upstream search strategy. */
export function useVideos(
  category: VideoCategory = "all",
  timeWindow: VideoTimeWindow = "month",
  sort: VideoSort = "trending",
) {
  return useQuery<VideosResponse>({
    queryKey: ["discover-videos", category, timeWindow, sort],
    queryFn: async () => {
      const params = new URLSearchParams({
        category,
        window: timeWindow,
        sort,
      });
      const res = await fetch(`/api/discover/videos?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to load videos");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Hold the previous grid in place across category/sort/window switches so
    // it dims instead of unmounting back to a full skeleton.
    placeholderData: keepPreviousData,
  });
}
