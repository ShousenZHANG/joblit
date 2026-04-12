"use client";

import { useState } from "react";
import { Compass, Github, Newspaper } from "lucide-react";
import { TrendingRepoList } from "./components/TrendingRepoList";
import { NewsList } from "./components/NewsList";

const TABS = [
  { value: "trending", label: "Trending", icon: Github },
  { value: "news", label: "AI & Tech News", icon: Newspaper },
] as const;

type ActiveTab = (typeof TABS)[number]["value"];

export function DiscoverClient() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("trending");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 ring-1 ring-emerald-100">
            <Compass className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 lg:text-2xl">
              Discover
            </h1>
            <p className="hidden text-sm text-slate-500 sm:block">
              What the industry is building and talking about this week
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar — always visible on all breakpoints */}
      <div className="shrink-0 px-4 pb-3 lg:px-6">
        <div className="inline-flex rounded-lg bg-slate-100/80 p-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition-all duration-150 lg:px-5 lg:py-2 lg:text-sm ${
                  activeTab === tab.value
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700 active:bg-white/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content — single active tab */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
        {activeTab === "trending" ? <TrendingRepoList /> : <NewsList />}
      </div>
    </div>
  );
}
