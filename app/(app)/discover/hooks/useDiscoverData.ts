import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/fetchJson";
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
      return (await fetchJson(
        `/api/discover/trending?period=${period}${clean ? "&clean=1" : ""}`,
        { fallbackError: "Failed to load trending repos" },
      )) as TrendingResponse;
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
      return (await fetchJson(`/api/discover/videos?${params.toString()}`, {
        fallbackError: "Failed to load videos",
      })) as VideosResponse;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Hold the previous grid in place across category/sort/window switches so
    // it dims instead of unmounting back to a full skeleton.
    placeholderData: keepPreviousData,
  });
}
