"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  DESCRIPTION_EXCLUSION_OPTIONS,
  TITLE_EXCLUSION_OPTIONS,
  TITLE_EXCLUSION_VALUES,
} from "@/lib/shared/fetchExclusionCriteria";
import { cn } from "@/lib/utils";

const RIGHTS_EXCLUSION_OPTIONS = DESCRIPTION_EXCLUSION_OPTIONS.filter(
  (o) => o.category === "rights",
);
const EXPERIENCE_EXCLUSION_OPTIONS = DESCRIPTION_EXCLUSION_OPTIONS.filter(
  (o) => o.category === "experience",
);

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

// New CN source list — aggregator-based, no cookie auth, no Bing proxy.
// See lib/server/cnFetch for implementation details.
const CN_SOURCES = [
  { value: "v2ex", label: "V2EX 酷工作" },
  { value: "github", label: "GitHub 招聘 Repos" },
  { value: "rsshub", label: "自建 RSSHub" },
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

type ExclusionOption = {
  value: string;
  label: string;
  help?: string;
};

function ExclusionDropdown({
  label,
  values,
  options,
  placeholder,
  testId,
  onChange,
}: {
  label: string;
  values: string[];
  options: readonly ExclusionOption[];
  placeholder: string;
  testId: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOptions = options.filter((opt) => values.includes(opt.value));
  const summaryText =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? selectedOptions[0].label
        : `${selectedOptions[0].label} +${selectedOptions.length - 1}`;

  function toggle(value: string, checked: boolean) {
    onChange(
      checked
        ? Array.from(new Set([...values, value]))
        : values.filter((v) => v !== value),
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid={`${testId}-trigger`}
            aria-label={`${label}: ${summaryText}`}
            aria-expanded={open}
            className={cn(
              "group flex h-11 w-full items-center justify-between gap-3 rounded-2xl border bg-background px-4 text-sm font-medium transition-all duration-200",
              "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
              "hover:shadow-[0_8px_22px_-14px_rgba(5,150,105,0.45)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-400/50 focus-visible:ring-offset-1",
              open
                ? "border-brand-emerald-300 bg-brand-emerald-50/40 shadow-[0_10px_28px_-14px_rgba(5,150,105,0.5)]"
                : "border-border/70 hover:border-brand-emerald-300/70",
            )}
          >
            <span
              className={cn(
                "min-w-0 truncate text-left",
                selectedOptions.length === 0
                  ? "text-muted-foreground/70"
                  : "text-foreground",
              )}
            >
              {summaryText}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {selectedOptions.length > 0 && (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand-emerald-100 px-1.5 text-[11px] font-semibold text-brand-emerald-700">
                  {selectedOptions.length}
                </span>
              )}
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200 ease-out",
                  open && "rotate-180 text-brand-emerald-700",
                )}
              />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          data-testid={`${testId}-menu`}
          className={cn(
            "w-[var(--radix-dropdown-menu-trigger-width)] min-w-[20rem]",
            "max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
            "rounded-2xl border border-border/60 bg-background/95 p-1.5 backdrop-blur-xl",
            "shadow-[0_24px_60px_-30px_rgba(15,23,42,0.5),0_8px_24px_-12px_rgba(5,150,105,0.16)]",
            "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={checked}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(c) => toggle(opt.value, c === true)}
                className={cn(
                  "relative flex cursor-pointer select-none items-start gap-3 rounded-xl py-2.5 pl-9 pr-3 text-sm transition-colors duration-150",
                  "focus:bg-brand-emerald-50/70 focus:text-foreground",
                  "data-[state=checked]:bg-brand-emerald-50/60 data-[state=checked]:text-foreground",
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "truncate font-medium leading-snug",
                      checked ? "text-brand-emerald-900" : "text-foreground",
                    )}
                  >
                    {opt.label}
                  </span>
                  {opt.help && (
                    <span className="mt-0.5 line-clamp-2 text-xs font-normal leading-snug text-muted-foreground">
                      {opt.help}
                    </span>
                  )}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Freeform add-on for title exclusions: lets the user add custom terms beyond
// the presets. Custom terms (those not in the preset list) render as removable
// chips so they're visible even though the preset dropdown can't show them.
function CustomTermAdder({
  terms,
  presets,
  onChange,
}: {
  terms: string[];
  presets: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const presetSet = new Set(presets);
  const customTerms = terms.filter((t) => !presetSet.has(t));

  function add() {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!terms.includes(value)) onChange([...terms, value]);
    setDraft("");
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add custom term…"
          aria-label="Add custom title exclusion term"
          className="h-9 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="h-9 shrink-0"
        >
          Add
        </Button>
      </div>
      {customTerms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customTerms.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-2.5 py-1 text-[11px] font-medium text-brand-emerald-700"
            >
              {t}
              <button
                type="button"
                onClick={() => onChange(terms.filter((x) => x !== t))}
                aria-label={`Remove ${t}`}
                className="text-brand-emerald-500 transition-colors hover:text-brand-emerald-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="h-11"
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
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

type FetchRunListItem = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  market: string;
  importedCount: number;
  title: string | null;
  queryCount: number;
  location: string | null;
  hoursOld: number | null;
  smartExpand: boolean | null;
  sources: string[] | null;
  excludeKeywords: string[] | null;
  createdAt: string;
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_DOT: Record<string, string> = {
  SUCCEEDED: "bg-brand-emerald-500",
  RUNNING: "bg-amber-500",
  QUEUED: "bg-amber-400",
  FAILED: "bg-destructive",
};

// Recent fetch history — lets the user see past runs and re-run one with a
// single click. Fails soft: if the list endpoint errors, it renders nothing
// rather than blocking the page. Refetches whenever a run starts or finishes
// so a just-completed fetch appears without a manual refresh.
function FetchHistory({ onRerun }: { onRerun: (run: FetchRunListItem) => void }) {
  const { runId, status } = useFetchStatus();
  const [runs, setRuns] = useState<FetchRunListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/fetch-runs", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (alive && json && Array.isArray(json.runs)) {
          setRuns(json.runs as FetchRunListItem[]);
        }
      } catch {
        // history is non-critical — stay silent on failure
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, status]);

  if (!loaded || runs.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border/60 pt-4">
      <div className="text-xs font-medium text-muted-foreground">Recent fetches</div>
      <ul className="space-y-1.5">
        {runs.map((run) => (
          <li
            key={run.id}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2"
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                STATUS_DOT[run.status] ?? "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {run.title ?? "Untitled search"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {run.queryCount > 1 ? `${run.queryCount} roles · ` : ""}
                {run.status === "SUCCEEDED"
                  ? `${run.importedCount} imported`
                  : run.status.toLowerCase()}
                {" · "}
                {relativeTime(run.createdAt)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRerun(run)}
              aria-label={`Re-run ${run.title ?? "search"}`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-foreground/80 transition-colors hover:border-brand-emerald-300 hover:bg-brand-emerald-50/60 hover:text-brand-emerald-700"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Re-run
            </button>
          </li>
        ))}
      </ul>
    </div>
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
  const [cnSources, setCnSources] = useState<string[]>(["v2ex", "github"]);
  const [cnExcludeKeywords, setCnExcludeKeywords] = useState("");
  const [hoursOld, setHoursOld] = useState(48);
  const [smartExpand, setSmartExpand] = useState(true);
  const [applyExcludes, setApplyExcludes] = useState(true);
  const [excludeTitleTerms, setExcludeTitleTerms] = useState<string[]>([
    "senior",
    "lead",
    "principal",
    "staff",
    "manager",
    "director",
    "head",
    "architect",
  ]);
  // Rights-type description rules only (identity/clearance/sponsorship).
  const [excludeDescriptionRules, setExcludeDescriptionRules] = useState<string[]>([
    "identity_requirement",
  ]);
  // Minimum-experience exclusion is a single choice ("" = off). Default-on at
  // 4+ alongside the title-seniority exclusions since this product targets
  // early-career roles.
  const [experienceRule, setExperienceRule] = useState<string>(
    "experience_requirement_4_plus",
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    startRun,
    status: globalStatus,
    runId: globalRunId,
    error: globalError,
  } = useFetchStatus();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const guideHighlightClass =
    "ring-2 ring-brand-emerald-400 ring-offset-2 ring-offset-background shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";
  const prevUserIdRef = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

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
  const suggestionMode = suggestionQuery.length < 2 ? "Popular" : "Suggestions";
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
    try {
      const parsed = JSON.parse(raw) as {
        title?: string;
        location?: string;
        hoursOld?: number;
        smartExpand?: boolean;
      };
      if (parsed.title) setJobTitle(parsed.title);
      if (parsed.location) setLocation(parsed.location);
      if (parsed.hoursOld) setHoursOld(parsed.hoursOld);
      if (typeof parsed.smartExpand === "boolean") setSmartExpand(parsed.smartExpand);
    } catch {
      // ignore invalid local preference payload
    }
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
          smartExpand,
        }),
      );
    }, 500);
    return () => window.clearTimeout(id);
  }, [jobTitle, location, hoursOld, smartExpand]);

  function getErrorMessage(err: unknown, fallback = "Failed") {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return fallback;
  }

  async function createRun() {
    const body = market === "CN"
      ? {
          market: "CN",
          queries,
          sources: cnSources,
          excludeKeywords: cnExcludeKeywords
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
          smartExpand,
          applyExcludes,
          excludeTitleTerms,
          excludeDescriptionRules: [
            ...excludeDescriptionRules,
            ...(experienceRule ? [experienceRule] : []),
          ],
        };

    const res = await fetch("/api/fetch-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    const message =
      typeof json?.error === "string"
        ? json.error
        : json?.error?.message || "Failed to create run";
    if (!res.ok) throw new Error(message);
    return json.id as string;
  }

  async function triggerRun(id: string) {
    const res = await fetch(`/api/fetch-runs/${id}/trigger`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Failed to trigger run");
  }

  async function onSubmit() {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (!queries.length) {
        throw new Error("Please enter at least one job title to search.");
      }
      const id = await createRun();
      startRun(id);
      await triggerRun(id);
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

  function handleRerun(run: FetchRunListItem) {
    if (run.title) setJobTitle(run.title);
    if (run.market === "CN") {
      if (run.sources?.length) setCnSources(run.sources);
      if (run.excludeKeywords) setCnExcludeKeywords(run.excludeKeywords.join(", "));
    } else {
      if (run.location) setLocation(run.location);
      if (typeof run.hoursOld === "number") setHoursOld(run.hoursOld);
      if (typeof run.smartExpand === "boolean") setSmartExpand(run.smartExpand);
    }
    setLocalError(null);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const activeError = localError ?? globalError;
  const isRunning =
    globalRunId !== null &&
    (globalStatus === "RUNNING" || globalStatus === "QUEUED" || globalStatus === null);

  return (
    <div
      ref={topRef}
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
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-destructive/40 bg-background/70 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-background disabled:pointer-events-none disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Retry
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
                  onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                  className="h-11 text-base"
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
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

          {/* Options row: chip toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`filter-chip ${smartExpand ? "filter-chip--active" : "filter-chip--inactive"}`}
              onClick={() => setSmartExpand(!smartExpand)}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${smartExpand ? "bg-brand-emerald-500" : "bg-muted-foreground/30"}`} />
              Smart expand
            </button>
            <button
              type="button"
              className={`filter-chip ${applyExcludes ? "filter-chip--active" : "filter-chip--inactive"}`}
              onClick={() => setApplyExcludes(!applyExcludes)}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${applyExcludes ? "bg-brand-emerald-500" : "bg-muted-foreground/30"}`} />
              Apply exclusions
            </button>
          </div>

          {/* Collapsible exclusion filters */}
          {applyExcludes && (
            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/30 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <ExclusionDropdown
                    label="Title exclusions"
                    values={excludeTitleTerms}
                    options={TITLE_EXCLUSION_OPTIONS}
                    placeholder="Select terms"
                    testId="title-exclusions"
                    onChange={setExcludeTitleTerms}
                  />
                  <CustomTermAdder
                    terms={excludeTitleTerms}
                    presets={TITLE_EXCLUSION_VALUES}
                    onChange={setExcludeTitleTerms}
                  />
                </div>
                <ExclusionDropdown
                  label="Description exclusions"
                  values={excludeDescriptionRules}
                  options={RIGHTS_EXCLUSION_OPTIONS}
                  placeholder="Select rules"
                  testId="description-exclusions"
                  onChange={setExcludeDescriptionRules}
                />
              </div>

              <div className="space-y-1.5 sm:max-w-xs">
                <Label htmlFor="fetch-experience" className="text-xs font-medium text-muted-foreground">
                  Minimum experience
                </Label>
                <Select
                  value={experienceRule || "off"}
                  onValueChange={(v) => setExperienceRule(v === "off" ? "" : v)}
                >
                  <SelectTrigger id="fetch-experience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">No experience filter</SelectItem>
                    {EXPERIENCE_EXCLUSION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

        {/* Start Fetch button */}
        <div className="pt-2" data-testid="fetch-actions">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || isRunning}
            className={`h-10 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 ${
              isTaskHighlighted("first_fetch") ? guideHighlightClass : ""
            }`}
            data-guide-highlight={isTaskHighlighted("first_fetch") ? "true" : "false"}
            data-guide-anchor="first_fetch"
          >
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
                  onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-between rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground/85 shadow-none"
                >
                  {cnSources.length ? `已选 (${cnSources.length})` : "选择来源"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {CN_SOURCES.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s.value}
                    checked={cnSources.includes(s.value)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) => {
                      setCnSources((prev) =>
                        checked
                          ? [...prev, s.value]
                          : prev.filter((v) => v !== s.value),
                      );
                    }}
                  >
                    {s.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-[11px] text-muted-foreground">
              V2EX 主源稳定免费；RSSHub 需自行配置 RSSHUB_URL。
            </p>
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
            className={`h-10 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 ${
              isTaskHighlighted("first_fetch") ? guideHighlightClass : ""
            }`}
            data-guide-highlight={isTaskHighlighted("first_fetch") ? "true" : "false"}
            data-guide-anchor="first_fetch"
          >
            {isSubmitting ? t("fetching") : t("startFetch")}
          </Button>
        </div>
      </div>
      )}

      <FetchHistory onRerun={handleRerun} />
    </div>
  );
}
