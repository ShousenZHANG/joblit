"use client";

import { useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTrendingRepos } from "../hooks/useDiscoverData";
import { TrendingRepoCard } from "./TrendingRepoCard";
import { TrendingSkeleton } from "./DiscoverSkeleton";

export function TrendingRepoList() {
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useTrendingRepos(period);

  const repos = data?.repos ?? [];

  return (
    <section>
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground lg:text-lg">
          Top 20 {period === "weekly" ? "This Week" : "This Month"}
        </h2>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as "weekly" | "monthly")}
          className="rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors focus:border-brand-emerald-300 focus:ring-1 focus:ring-brand-emerald-100"
          aria-label="Time period"
        >
          <option value="weekly">This week</option>
          <option value="monthly">This month</option>
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <TrendingSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <AlertCircle className="h-5 w-5 text-rose-500" />
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load trending repos"}
          </p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["discover-trending"] })}
            className="flex items-center gap-1.5 rounded-lg bg-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-rose-200"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : repos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No trending repos found.
        </p>
      ) : (
        <div className="grid gap-2 sm:gap-3">
          {repos.map((repo) => (
            <TrendingRepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </section>
  );
}
