"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useFetchStatus } from "@/app/FetchStatusContext";
import { useGuide } from "@/app/GuideContext";
import { useMarket } from "@/hooks/useMarket";
import { triggerFetchRunWithRecovery } from "@/lib/client/triggerFetchRun";

const COMMON_TITLES = [
  "Software Engineer",
  "Software Developer",
  "Web Developer",
  "Backend Engineer",
  "Backend Developer",
  "Full Stack Engineer",
  "Full Stack Developer",
  "Full Stack Agentic Engineer",
  "AI Engineer",
  "AI Developer",
  "Machine Learning Engineer",
  "Data Engineer",
  "Platform Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Cloud Engineer",
  "QA Engineer",
  "Mobile Developer",
  "Product Engineer",
  "Security Engineer",
];

const CN_COMMON_TITLES = [
  "前端开发工程师",
  "后端开发工程师",
  "全栈开发工程师",
  "Java开发工程师",
  "Python开发工程师",
  "React开发工程师",
  "移动端开发工程师",
  "测试开发工程师",
  "运维工程师",
  "数据工程师",
  "算法工程师",
  "产品经理",
];

// Location presets — pick-or-type. AU JobSpy wants region/state strings; the
// list mirrors the Jobs page state options while still allowing a free-typed
// city (e.g. "Sydney, New South Wales, Australia").
const AU_LOCATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Sydney, New South Wales, Australia", label: "Sydney" },
  { value: "Melbourne, Victoria, Australia", label: "Melbourne" },
  { value: "Brisbane, Queensland, Australia", label: "Brisbane" },
  { value: "Perth, Western Australia, Australia", label: "Perth" },
  { value: "Adelaide, South Australia, Australia", label: "Adelaide" },
  { value: "Canberra, Australian Capital Territory, Australia", label: "Canberra" },
  { value: "New South Wales, Australia", label: "New South Wales" },
  { value: "Victoria, Australia", label: "Victoria" },
  { value: "Queensland, Australia", label: "Queensland" },
  { value: "Australia", label: "All of Australia" },
];

function LocationCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const query = value.trim().toLowerCase();
  const list = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query) ||
          o.value.toLowerCase().includes(query),
      )
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="h-11"
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Selecting an option must not blur the input first. A press-and-hold
        // longer than a blur timeout used to unmount the list mid-tap (options
        // vanished under the finger); preventing default keeps input focus so
        // onSelect always lands, and blur can close instantly with no timer.
        onPointerDown={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-64 p-1">
            {list.length ? (
              <CommandGroup heading="Locations">
                {list.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>Type a custom location.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function FetchClient() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const t = useTranslations("fetch");
  const [jobTitle, setJobTitle] = useState("Software Engineer");
  const [location, setLocation] = useState("Sydney, New South Wales, Australia");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const market = useMarket();
  const [cnExcludeKeywords, setCnExcludeKeywords] = useState("");
  const [cnLocation, setCnLocation] = useState("");
  const [hoursOld, setHoursOld] = useState(48);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    startRuns,
    status: globalStatus,
    runId: globalRunId,
    error: globalError,
  } = useFetchStatus();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const guideHighlightClass =
    "ring-2 ring-brand-emerald-400 ring-offset-2 ring-offset-background shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";
  const prevUserIdRef = useRef<string | null>(null);

  const queries = useMemo(() => {
    const parts = jobTitle
      .split(/[\n,|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return Array.from(new Set(parts));
  }, [jobTitle]);

  const suggestionQuery = useMemo(() => {
    const segments = jobTitle.split(/[\n,|]/);
    return (segments.at(-1) ?? "").trim().toLowerCase();
  }, [jobTitle]);
  // Hardcoded English until now — the fetch.popular / fetch.suggestions keys
  // existed but nothing read them, so a zh-CN user saw an English heading.
  const suggestionMode = t(suggestionQuery.length < 2 ? "popular" : "suggestions");
  const suggestions = useMemo(() => {
    const titles = market === "CN" ? CN_COMMON_TITLES : COMMON_TITLES;
    if (suggestionQuery.length < 2) {
      return titles.slice(0, 12);
    }
    return titles.filter((title) =>
      title.toLowerCase().includes(suggestionQuery),
    ).slice(0, 12);
  }, [suggestionQuery, market]);

  useEffect(() => {
    const prev = prevUserIdRef.current;
    if (prev && prev !== userId) {
      setLocalError(null);
      setIsSubmitting(false);
    }
    prevUserIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    const raw = localStorage.getItem("joblit.fetch.preferences");
    if (!raw) return;
    let cancelled = false;
    try {
      const parsed = JSON.parse(raw) as {
        title?: string;
        location?: string;
        hoursOld?: number;
      };
      queueMicrotask(() => {
        if (cancelled) return;
        if (parsed.title) setJobTitle(parsed.title);
        if (parsed.location) setLocation(parsed.location);
        if (parsed.hoursOld) setHoursOld(parsed.hoursOld);
      });
    } catch {
      // ignore invalid local preference payload
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Debounce so we write once 500ms after the user stops typing instead
    // of on every keystroke (jobTitle changes per character). Hammering
    // localStorage synchronously on each keypress can jank the input on
    // low-end devices.
    const id = window.setTimeout(() => {
      localStorage.setItem(
        "joblit.fetch.preferences",
        JSON.stringify({
          title: jobTitle,
          location,
          hoursOld,
        }),
      );
    }, 500);
    return () => window.clearTimeout(id);
  }, [jobTitle, location, hoursOld]);

  function getErrorMessage(err: unknown, fallback = "Failed") {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return fallback;
  }

  function getApiErrorMessage(res: Response, json: unknown, fallback: string) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return fallback;
    const error = (json as { error?: unknown }).error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    return fallback;
  }

  async function createRun() {
    const body = market === "CN"
      ? {
          market: "CN",
          queries,
          sources: ["nowcoder"],
          excludeKeywords: cnExcludeKeywords
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
          locations: cnLocation
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {
          market: "AU",
          title: queries[0] ?? jobTitle.trim(),
          queries,
          location,
          hoursOld,
        };

    const res = await fetch("/api/fetch-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(getApiErrorMessage(res, json, "Failed to create run"));
    return json.id as string;
  }

  async function triggerRun(run: {
    id: string;
    source: "jobspy" | "nowcoder";
  }) {
    await triggerFetchRunWithRecovery(run, {
      errorMessage: (response, body) =>
        getApiErrorMessage(response, body, "Failed to trigger run"),
    });
  }

  async function onSubmit() {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (!queries.length) {
        throw new Error("Please enter at least one job title to search.");
      }
      const run: {
        id: string;
        source: "jobspy" | "nowcoder";
      } = {
        id: await createRun(),
        source: market === "CN" ? "nowcoder" : "jobspy",
      };
      startRuns([run]);
      await triggerRun(run);
      markTaskComplete("first_fetch");
    } catch (e: unknown) {
      setLocalError(getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Warn before leaving while a fetch-run create is still in flight, so
  // the user doesn't abandon a half-dispatched run. Form inputs are
  // already persisted to localStorage, so only the in-flight submit needs
  // guarding.
  useEffect(() => {
    if (!isSubmitting) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isSubmitting]);

  const activeError = localError ?? globalError;
  const isRunning =
    globalRunId !== null &&
    (globalStatus === "RUNNING" || globalStatus === "QUEUED" || globalStatus === null);

  return (
    <div
      className="space-y-4 px-4 py-4 lg:px-6"
      onKeyDown={(e) => {
        // Cmd/Ctrl+Enter submits from anywhere in the form — editor-grade
        // shortcut. Plain Enter stays free for picking title suggestions.
        if (
          (e.metaKey || e.ctrlKey) &&
          e.key === "Enter" &&
          !isSubmitting &&
          !isRunning
        ) {
          e.preventDefault();
          void onSubmit();
        }
      }}
    >
      {activeError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{activeError}</span>
          {localError ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting || isRunning}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-destructive/40 bg-background/70 px-4 text-sm font-semibold text-destructive transition-colors hover:bg-background disabled:pointer-events-none disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t("retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {market === "AU" && (
      <div className="space-y-4">
          {/* Primary search: job title (full width, prominent) */}
          <div className="space-y-1.5">
            <Label htmlFor="fetch-job-title" className="text-xs font-medium text-muted-foreground">{t("jobTitle")}</Label>
            <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
              <PopoverAnchor asChild>
                <Input
                  id="fetch-job-title"
                  placeholder="e.g. Software Engineer, Frontend Engineer | Backend Engineer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  onFocus={() => { setSuggestionsOpen(true); }}
                  onBlur={() => setSuggestionsOpen(false)}
                  className="h-11 text-base"
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
                // Keep input focus through option taps — see LocationCombobox.
                onPointerDown={(e) => e.preventDefault()}
              >
                <Command shouldFilter={false}>
                  <CommandList className="max-h-64 p-1">
                    {suggestions.length ? (
                      <CommandGroup heading={suggestionMode}>
                        {suggestions.map((item) => (
                          <CommandItem
                            key={item}
                            value={item}
                            onSelect={(value) => {
                              const segments = jobTitle.split(/[\n,|]/);
                              const prefix = segments.slice(0, -1).map((part) => part.trim()).filter(Boolean);
                              setJobTitle([...prefix, value].join(", "));
                              setSuggestionsOpen(false);
                            }}
                          >
                            {item}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : (
                      <CommandEmpty>No suggestions found.</CommandEmpty>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Secondary fields: location + hours on one row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fetch-location" className="text-xs font-medium text-muted-foreground">{t("locationLabel")}</Label>
              <LocationCombobox
                id="fetch-location"
                value={location}
                onChange={setLocation}
                options={AU_LOCATIONS}
                placeholder="State or city, e.g. Sydney"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fetch-hours" className="text-xs font-medium text-muted-foreground">{t("hoursOld")}</Label>
              <Select value={String(hoursOld)} onValueChange={(v) => setHoursOld(Number(v))}>
                <SelectTrigger id="fetch-hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 6, 12, 24, 48, 72].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h} hours
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <section
            aria-labelledby="fetch-policy-title"
            className="rounded-2xl border border-brand-emerald-200/70 bg-brand-emerald-50/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-brand-emerald-800/60 dark:bg-brand-emerald-950/20"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-emerald-100 text-brand-emerald-text dark:bg-brand-emerald-900/50">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3
                  id="fetch-policy-title"
                  className="text-sm font-semibold text-foreground"
                >
                  {t("policy.title")}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("policy.summary")}
                </p>
              </div>
            </div>
            <ul className="mt-3 grid gap-2 text-xs leading-5 text-foreground/80 sm:grid-cols-2">
              {(["seniority", "identity", "clearance", "experience"] as const).map(
                (rule) => (
                  <li key={rule} className="flex items-start gap-2">
                    <span
                      className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-emerald-500"
                      aria-hidden
                    />
                    <span>{t(`policy.${rule}`)}</span>
                  </li>
                ),
              )}
            </ul>
          </section>

        {/* Start Fetch button */}
        <div className="pt-2" data-testid="fetch-actions">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || isRunning}
            className={`h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 ${
              isTaskHighlighted("first_fetch") ? guideHighlightClass : ""
            }`}
            data-guide-highlight={isTaskHighlighted("first_fetch") ? "true" : "false"}
            data-guide-anchor="first_fetch"
          >
            {isSubmitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {isSubmitting ? t("fetching") : t("startFetch")}
          </Button>
        </div>
      </div>
      )}

      {market === "CN" && (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("jobTitle")}</Label>
            <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
              <PopoverAnchor asChild>
                <Input
                  placeholder="例如 前端开发工程师"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  onFocus={() => {
                    setSuggestionsOpen(true);
                  }}
                  onBlur={() => setSuggestionsOpen(false)}
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
                // Keep input focus through option taps — see LocationCombobox.
                onPointerDown={(e) => e.preventDefault()}
              >
                <Command shouldFilter={false}>
                  <CommandList className="max-h-64 p-1">
                    {suggestions.length ? (
                      <CommandGroup heading={suggestionMode}>
                        {suggestions.map((item) => (
                          <CommandItem
                            key={item}
                            value={item}
                            onSelect={(value) => {
                              const segments = jobTitle.split(/[\n,|]/);
                              const prefix = segments.slice(0, -1).map((part) => part.trim()).filter(Boolean);
                              setJobTitle([...prefix, value].join(", "));
                              setSuggestionsOpen(false);
                            }}
                          >
                            {item}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : (
                      <CommandEmpty>No suggestions found.</CommandEmpty>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>{t("cnSources")}</Label>
            {/* Single fixed source — Nowcoder. A read-only indicator, not a
                picker: all CN job data comes from 牛客网 via the configured
                RSSHub instance, so there is nothing to choose. */}
            <div className="flex h-10 items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-100">
                <Briefcase className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="text-sm font-medium text-foreground">牛客网</span>
              <span className="ml-auto rounded-full bg-brand-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-brand-emerald-text ring-1 ring-brand-emerald-100">
                官方源
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              职位均来自牛客网招聘广场。
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t("cnLocation")}</Label>
            <Input
              placeholder="可选，逗号分隔，例如 北京,上海,深圳"
              value={cnLocation}
              onChange={(e) => setCnLocation(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("cnExcludeKeywords")}</Label>
            <Input
              placeholder="逗号分隔，例如 实习,兼职"
              value={cnExcludeKeywords}
              onChange={(e) => setCnExcludeKeywords(e.target.value)}
            />
          </div>
        </div>

        {/* Start Fetch button (CN) */}
        <div className="pt-2" data-testid="fetch-actions-cn">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || isRunning}
            className={`h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 ${
              isTaskHighlighted("first_fetch") ? guideHighlightClass : ""
            }`}
            data-guide-highlight={isTaskHighlighted("first_fetch") ? "true" : "false"}
            data-guide-anchor="first_fetch"
          >
            {isSubmitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {isSubmitting ? t("fetching") : t("startFetch")}
          </Button>
        </div>
      </div>
      )}

    </div>
  );
}
