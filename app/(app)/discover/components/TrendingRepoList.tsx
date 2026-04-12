"use client";

import { useState, useMemo } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTrendingRepos } from "../hooks/useDiscoverData";
import { TrendingRepoCard } from "./TrendingRepoCard";
import { TrendingSkeleton } from "./DiscoverSkeleton";

const LANGUAGE_FILTERS = ["All", "Python", "TypeScript", "Rust", "Go", "Java"];

export function TrendingRepoList() {
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [langFilter, setLangFilter] = useState("All");
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useTrendingRepos(period);

  const filtered = useMemo(() => {
    if (!data?.repos) return [];
    if (langFilter === "All") return data.repos;
    return data.repos.filter((r) => r.language === langFilter);
  }, [data?.repos, langFilter]);

  return (
    <section>
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900 lg:text-lg">
          GitHub Trending
        </h2>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as "weekly" | "monthly")}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 outline-none transition-colors focus:border-emerald-300 focus:ring-1 focus:ring-emerald-100"
          aria-label="Time period"
        >
          <option value="weekly">This week</option>
          <option value="monthly">This month</option>
        </select>
      </div>

      {/* Language filter pills */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {LANGUAGE_FILTERS.map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => setLangFilter(lang)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-all duration-150 ${
              langFilter === lang
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {lang}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <TrendingSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="h-5 w-5 text-rose-500" />
          <p className="text-sm text-rose-700">
            {error instanceof Error ? error.message : "Failed to load trending repos"}
          </p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["discover-trending"] })}
            className="flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-200"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No repos found for this filter.
        </p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((repo) => (
            <TrendingRepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </section>
  );
}
