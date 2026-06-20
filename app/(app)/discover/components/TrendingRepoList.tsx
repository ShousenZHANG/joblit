"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTrendingRepos } from "../hooks/useDiscoverData";
import { TrendingRepoCard } from "./TrendingRepoCard";
import { TrendingSkeleton } from "./DiscoverSkeleton";

export function TrendingRepoList() {
  const t = useTranslations("discover");
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [clean, setClean] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData, error } = useTrendingRepos(
    period,
    clean,
  );

  const repos = data?.repos ?? [];
  // Only show the full skeleton on first load; later period/filter switches keep
  // the previous grid in place (via keepPreviousData) and just dim it.
  const showSkeleton = isLoading && !data;
  const listOpacityClass = isPlaceholderData ? "opacity-95" : "opacity-100";

  return (
    <section>
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground lg:text-lg">
          {period === "weekly" ? t("topThisWeek") : t("topThisMonth")}
        </h2>
        <div className="flex items-center gap-2">
          {/* Optional noise filter — off = exact github.com/trending parity. */}
          <button
            type="button"
            onClick={() => setClean((c) => !c)}
            aria-pressed={clean}
            title={t("hideNoiseHint")}
            className={
              "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " +
              (clean
                ? "border-brand-emerald-300 bg-brand-emerald-50 text-brand-emerald-700"
                : "border-border bg-card text-muted-foreground hover:border-brand-emerald-200")
            }
          >
            {t("hideNoise")}
          </button>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as "weekly" | "monthly")}
            className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors focus:border-brand-emerald-300 focus:ring-1 focus:ring-brand-emerald-100"
            aria-label="Time period"
          >
            <option value="weekly">{t("periodWeek")}</option>
            <option value="monthly">{t("periodMonth")}</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {showSkeleton ? (
        <TrendingSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <AlertCircle className="h-5 w-5 text-rose-500" />
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : t("errorRepos")}
          </p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["discover-trending"] })}
            className="flex items-center gap-1.5 rounded-lg bg-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-rose-200"
          >
            <RefreshCw className="h-3 w-3" />
            {t("retry")}
          </button>
        </div>
      ) : repos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("noRepos")}
        </p>
      ) : (
        <div
          className={`grid gap-2 transition-opacity duration-200 ease-out sm:gap-3 ${listOpacityClass}`}
        >
          {repos.map((repo) => (
            <TrendingRepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </section>
  );
}
