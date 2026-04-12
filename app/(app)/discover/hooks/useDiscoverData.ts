import { useQuery } from "@tanstack/react-query";
import type { TrendingResponse, NewsResponse } from "../types";

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

export function useNews(source: "all" | "hn" | "devto" = "all") {
  return useQuery<NewsResponse>({
    queryKey: ["discover-news", source],
    queryFn: async () => {
      const res = await fetch(`/api/discover/news?source=${source}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to load news");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
