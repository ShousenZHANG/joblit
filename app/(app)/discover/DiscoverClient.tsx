"use client";

import { useState } from "react";
import { Compass, Github, Newspaper } from "lucide-react";
import { TrendingRepoList } from "./components/TrendingRepoList";
import { NewsList } from "./components/NewsList";

const MOBILE_TABS = [
  { value: "trending", label: "Trending", icon: Github },
  { value: "news", label: "News", icon: Newspaper },
] as const;

type MobileTab = (typeof MOBILE_TABS)[number]["value"];

export function DiscoverClient() {
  const [mobileTab, setMobileTab] = useState<MobileTab>("trending");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
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

      {/* Mobile tabs */}
      <div className="shrink-0 px-4 pb-3 lg:hidden">
        <div className="flex rounded-lg bg-slate-100/80 p-0.5">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setMobileTab(tab.value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all duration-150 ${
                  mobileTab === tab.value
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 active:bg-white/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
        {/* Desktop: both sections stacked */}
        <div className="hidden lg:flex lg:flex-col lg:gap-8">
          <TrendingRepoList />
          <NewsList />
        </div>

        {/* Mobile: tab content */}
        <div className="lg:hidden">
          {mobileTab === "trending" ? <TrendingRepoList /> : <NewsList />}
        </div>
      </div>
    </div>
  );
}
