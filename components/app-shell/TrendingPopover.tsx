"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Flame, Star, TrendingUp } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { formatCount, type TrendingRepo, type TrendingResponse } from "@/lib/shared/trending";

/**
 * GitHub Trending as an ambient nav panel.
 *
 * This replaces the Discover workspace: a whole page for a read-only external
 * leaderboard was a second product bolted onto a job-search tool. As a
 * popover it costs one glyph of chrome and stays out of the way of the actual
 * workflow.
 *
 * Fetch policy: nothing loads until the panel is opened for the first time,
 * and the result is held for the session. The route itself is cached for 25h
 * server-side, so a reopen is cheap even across reloads.
 */

type Period = "weekly" | "monthly";

const LANG_COLORS: Record<string, string> = {
  Python: "bg-blue-500",
  TypeScript: "bg-sky-500",
  JavaScript: "bg-yellow-400",
  Rust: "bg-orange-600",
  Go: "bg-cyan-500",
  Java: "bg-red-500",
  "C++": "bg-pink-500",
  C: "bg-slate-600",
  Swift: "bg-orange-400",
  Kotlin: "bg-violet-500",
  Ruby: "bg-red-600",
  PHP: "bg-indigo-400",
};

function RepoRow({ repo }: { repo: TrendingRepo }) {
  const t = useTranslations("trending");
  const langColor = repo.language
    ? (LANG_COLORS[repo.language] ?? "bg-slate-400")
    : null;

  return (
    <li>
      <a
        href={repo.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-lg px-2.5 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground group-hover:text-brand-emerald-text">
            {repo.fullName}
          </span>
          {repo.starsGained > 0 ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-brand-emerald-600"
              title={t("starsGained")}
            >
              <TrendingUp className="h-3 w-3" aria-hidden />
              {formatCount(repo.starsGained)}
            </span>
          ) : null}
          <ExternalLink
            className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground"
            aria-hidden
          />
        </div>
        {repo.description ? (
          <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
            {repo.description}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
          {repo.language ? (
            <span className="inline-flex items-center gap-1">
              {langColor ? (
                <span className={`inline-block h-2 w-2 rounded-full ${langColor}`} aria-hidden />
              ) : null}
              {repo.language}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" aria-hidden />
            {formatCount(repo.stars)}
          </span>
        </div>
      </a>
    </li>
  );
}

export function TrendingPopover({ className }: { className?: string }) {
  const t = useTranslations("trending");
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("weekly");
  const [repos, setRepos] = useState<Record<Period, TrendingRepo[] | undefined>>({
    weekly: undefined,
    monthly: undefined,
  });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // A period switch must not be overwritten by a slower earlier response.
  const requestSeq = useRef(0);
  // Which periods have been asked for. A ref, not state: it gates a side
  // effect, and a failed attempt is removed so the panel can try again.
  const requested = useRef<Set<Period>>(new Set());

  const load = useCallback(async (next: Period) => {
    const seq = ++requestSeq.current;
    requested.current.add(next);
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/discover/trending?period=${next}`);
      if (!res.ok) throw new Error(`trending ${res.status}`);
      const data = (await res.json()) as TrendingResponse;
      if (seq !== requestSeq.current) return;
      setRepos((prev) => ({ ...prev, [next]: data.repos }));
    } catch {
      requested.current.delete(next);
      if (seq !== requestSeq.current) return;
      setFailed(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Loading is driven by the two events that can need data — opening the panel
  // and switching period — rather than by an effect watching that state. An
  // effect would re-run on every write to `repos` and needs its own guard
  // against cascading renders; handlers simply ask once, when asked.
  const ensureLoaded = useCallback(
    (next: Period) => {
      if (requested.current.has(next)) return;
      void load(next);
    },
    [load],
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) ensureLoaded(period);
  };

  const selectPeriod = (next: Period) => {
    setPeriod(next);
    ensureLoaded(next);
  };

  const current = repos[period];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t("open")}
          title={t("open")}
          data-testid="trending-trigger"
          className={
            "inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 md:h-9 md:w-9 " +
            (className ?? "")
          }
        >
          <Flame className="h-4 w-4" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        data-testid="trending-panel"
        className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold tracking-tight text-foreground">
              {t("title")}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          {/* Segmented period switch — the only control the panel needs. */}
          <div
            className="flex shrink-0 items-center rounded-full bg-muted p-0.5"
            role="group"
            aria-label={t("periodLabel")}
          >
            {(["weekly", "monthly"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => selectPeriod(value)}
                aria-pressed={period === value}
                className={
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 " +
                  (period === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {t(value === "weekly" ? "periodWeek" : "periodMonth")}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[min(28rem,60vh)] overflow-y-auto p-1.5">
          {current && current.length > 0 ? (
            <ul role="list" className="space-y-0.5">
              {current.map((repo) => (
                <RepoRow key={repo.id} repo={repo} />
              ))}
            </ul>
          ) : loading ? (
            <ul role="list" aria-busy className="space-y-1 p-1.5">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="space-y-1.5 rounded-lg px-1 py-1.5">
                  <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted/70" />
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                {failed ? t("error") : t("empty")}
              </p>
              {failed ? (
                <button
                  type="button"
                  onClick={() => void load(period)}
                  className="mt-2 rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
                >
                  {t("retry")}
                </button>
              ) : null}
            </div>
          )}
        </div>

        <a
          href="https://github.com/trending"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 border-t border-border/60 px-4 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          {t("viewOnGitHub")}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  );
}
