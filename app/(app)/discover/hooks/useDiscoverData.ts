import { useQuery } from "@tanstack/react-query";
import type {
  TrendingResponse,
  VideosResponse,
  VideoCategory,
  VideoTimeWindow,
} from "../types";

export function useTrendingRepos(period: "weekly" | "monthly" = "weekly") {
  return useQuery<TrendingResponse>({
    queryKey: ["discover-trending", period],
    queryFn: async () => {
      const res = await fetch(`/api/discover/trending?period=${period}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to load trending repos");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch videos for a single category. Sort is applied client-side from the
 * cached candidate pool — switching sort never re-hits the YouTube API.
 */
export function useVideos(
  category: VideoCategory = "all",
  timeWindow: VideoTimeWindow = "month",
) {
  return useQuery<VideosResponse>({
    queryKey: ["discover-videos", category, timeWindow],
    queryFn: async () => {
      const params = new URLSearchParams({ category, window: timeWindow });
      const res = await fetch(`/api/discover/videos?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to load videos");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
