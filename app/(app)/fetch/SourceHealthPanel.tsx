"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SourceStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";

type SourceHealthData = {
  generatedAt: string;
  sources: Array<{
    sourceId: string;
    kind: "core" | "ats";
    label: string;
    provider: string;
    region: string | null;
    status: SourceStatus;
    consecutiveFailures: number;
    lastCheckedAt: string | null;
  }>;
  summary: Record<Lowercase<SourceStatus>, number>;
  configurationIssueCount: number;
};

type ApiEnvelope = {
  data?: SourceHealthData;
  error?: { message?: string };
};

const statusStyles: Record<SourceStatus, string> = {
  HEALTHY: "bg-brand-emerald-500",
  DEGRADED: "bg-amber-500",
  DOWN: "bg-destructive",
  UNKNOWN: "bg-muted-foreground/35",
};

export function SourceHealthPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations("fetch.sourceHealth");
  const [data, setData] = useState<SourceHealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/sources/health", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | ApiEnvelope
        | null;
      if (!response.ok || !payload?.data) throw new Error("SOURCE_HEALTH_FAILED");
      setData(payload.data);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(true);
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [enabled, load, refreshKey]);

  const visibleSources = useMemo(() => {
    if (!data) return [];
    const core = data.sources.filter((source) => source.kind === "core");
    const attention = data.sources.filter(
      (source) => source.kind === "ats" && source.status !== "HEALTHY",
    );
    return [...core, ...attention].slice(0, 8);
  }, [data]);

  if (!enabled) return null;

  const total = data?.sources.length ?? 0;
  const healthy = data?.summary.healthy ?? 0;
  const needsAttention =
    (data?.summary.degraded ?? 0) + (data?.summary.down ?? 0);

  return (
    <section
      data-testid="source-health-panel"
      className="overflow-hidden rounded-2xl border border-border/60 bg-background/75 shadow-[0_12px_28px_-26px_rgba(15,23,42,0.7)]"
      aria-live="polite"
    >
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-emerald-600">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-100">
            {loading ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Activity className="h-4 w-4" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              {t("title")}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {loading
                ? t("checking")
                : error
                  ? t("unavailable")
                  : needsAttention > 0
                    ? t("attention", { count: needsAttention })
                    : t("ready", { healthy, total })}
            </span>
          </span>
          {!loading && !error && data ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  needsAttention > 0 ? "bg-amber-500" : "bg-brand-emerald-500",
                )}
              />
              {healthy}/{total}
            </span>
          ) : null}
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="border-t border-border/50 px-3.5 py-3">
          {error ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-foreground">
                {t("errorHint")}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                <RefreshCw aria-hidden />
                {t("retry")}
              </Button>
            </div>
          ) : data ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleSources.map((source) => (
                  <div
                    key={source.sourceId}
                    className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/30 px-3 py-2"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        statusStyles[source.status],
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {source.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t(`status.${source.status.toLowerCase()}`)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[11px] leading-5 text-muted-foreground">
                {data.sources.length > visibleSources.length
                  ? t("moreSources", {
                      count: data.sources.length - visibleSources.length,
                    })
                  : t("updatedAfterFetch")}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("checking")}</p>
          )}
        </div>
      </details>
    </section>
  );
}
