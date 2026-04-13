"use client";

import { AlertCircle, RefreshCw, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVideos } from "../hooks/useDiscoverData";
import { VideoCard } from "./VideoCard";
import { VideoSkeleton } from "./DiscoverSkeleton";

const HEADING = (
  <h2 className="mb-4 text-base font-semibold text-slate-900 lg:text-lg">
    AI Videos
  </h2>
);

export function VideoList() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useVideos();

  const items = data?.items ?? [];
  const noApiKey = data?.noApiKey === true;

  return (
    <section>
      {HEADING}

      {noApiKey && !isLoading ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <KeyRound className="h-5 w-5 text-amber-500" />
          <p className="text-sm font-medium text-amber-700">
            YouTube API key required
          </p>
          <p className="text-xs text-amber-600">
            Add <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">YOUTUBE_API_KEY</code> to Vercel environment variables.
            Free tier: 10,000 units/day.
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
            onClick={() => queryClient.invalidateQueries({ queryKey: ["discover-videos"] })}
            className="flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-200"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No AI videos found this week.
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
