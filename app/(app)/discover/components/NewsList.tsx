"use client";

import { useState, useMemo } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNews } from "../hooks/useDiscoverData";
import { NewsCard } from "./NewsCard";
import { NewsSkeleton } from "./DiscoverSkeleton";

const SOURCE_TABS = [
  { value: "all", label: "All" },
  { value: "hn", label: "Hacker News" },
  { value: "devto", label: "Dev.to" },
] as const;

export function NewsList() {
  const [sourceFilter, setSourceFilter] = useState<"all" | "hn" | "devto">("all");
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useNews();

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    if (sourceFilter === "all") return data.items;
    return data.items.filter((it) => it.source === sourceFilter);
  }, [data?.items, sourceFilter]);

  return (
    <section>
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900 lg:text-lg">
          AI & Tech News
        </h2>
      </div>

      {/* Source tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {SOURCE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setSourceFilter(tab.value)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-all duration-150 ${
              sourceFilter === tab.value
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <NewsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="h-5 w-5 text-rose-500" />
          <p className="text-sm text-rose-700">
            {error instanceof Error ? error.message : "Failed to load news"}
          </p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["discover-news"] })}
            className="flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-200"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No AI/tech news found.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
