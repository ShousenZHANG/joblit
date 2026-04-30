"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
import { cn } from "@/lib/utils";

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

const TITLE_EXCLUSION_OPTIONS = [
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "principal", label: "Principal" },
  { value: "staff", label: "Staff" },
  { value: "manager", label: "Manager" },
  { value: "director", label: "Director" },
  { value: "head", label: "Head" },
  { value: "architect", label: "Architect" },
];

const DESCRIPTION_EXCLUSION_OPTIONS = [
  { value: "identity_requirement", label: "PR/Citizen requirement" },
  { value: "clearance_requirement", label: "Security clearance required" },
  { value: "sponsorship_unavailable", label: "No visa sponsorship" },
];

const exclusionDropdownContentClass =
  "w-[var(--radix-dropdown-menu-trigger-width)] min-w-[18rem] max-h-[min(22rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto rounded-2xl border border-border/70 bg-background/95 p-2 text-foreground shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45),0_8px_20px_-14px_rgba(5,150,105,0.28)] backdrop-blur-xl origin-[var(--radix-dropdown-menu-content-transform-origin)] will-change-[opacity,transform] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-top-1";

const exclusionDropdownItemClass =
  "min-h-10 rounded-xl py-2 pl-8 pr-2 text-sm transition-colors duration-150 focus:bg-brand-emerald-50 focus:text-brand-emerald-800 data-[state=checked]:bg-brand-emerald-50 data-[state=checked]:text-brand-emerald-800";

type ExclusionOption = {
  value: string;
  label: string;
};

function ExclusionDropdown({
  label,
  values,
  options,
  placeholder,
  disabled,
  testId,
  onChange,
}: {
  label: string;
  values: string[];
  options: ExclusionOption[];
  placeholder: string;
  disabled?: boolean;
  testId: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = values.length ? `Selected (${values.length})` : placeholder;

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "group h-12 w-full justify-between rounded-2xl border border-border/80 bg-background px-4 text-sm font-medium text-foreground/85 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-brand-emerald-300 hover:bg-brand-emerald-50/40 hover:shadow-[0_10px_24px_-18px_rgba(5,150,105,0.55)] focus-visible:border-brand-emerald-500 focus-visible:ring-brand-emerald-500/20 active:scale-[0.995] disabled:opacity-50",
              open && "border-brand-emerald-300 bg-brand-emerald-50/50 shadow-[0_12px_28px_-20px_rgba(5,150,105,0.6)]",
            )}
            disabled={disabled}
            aria-label={`${label}: ${summary}`}
            aria-expanded={open}
            data-testid={`${testId}-trigger`}
          >
            <span className="min-w-0 truncate text-left">{summary}</span>
            <span className="ml-3 flex shrink-0 items-center gap-2">
              {values.length ? (
                <span className="rounded-full bg-brand-emerald-100 px-2 py-0.5 text-xs font-semibold text-brand-emerald-700">
                  {values.length}
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200 ease-out group-hover:text-brand-emerald-700",
                  open && "rotate-180 text-brand-emerald-700",
                )}
                aria-hidden
              />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className={exclusionDropdownContentClass}
          data-testid={`${testId}-menu`}
        >
          <div className="px-2 pb-2 pt-1.5">
            <div className="text-sm font-semibold text-foreground">{label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Keep results focused by hiding matching jobs.
            </div>
          </div>
          <div className="my-1 h-px bg-border/70" />
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={checked}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checkedValue) => {
                  onChange(
                    checkedValue === true
                      ? Array.from(new Set([...values, opt.value]))
                      : values.filter((value) => value !== opt.value),
                  );
                }}
                className={exclusionDropdownItemClass}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
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
  const [excludeDescriptionRules, setExcludeDescriptionRules] = useState<string[]>([
    "identity_requirement",
  ]);

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
    "ring-2 ring-brand-emerald-400 ring-offset-2 ring-offset-white shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";
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
    localStorage.setItem(
      "joblit.fetch.preferences",
      JSON.stringify({
        title: jobTitle,
        location,
        hoursOld,
        smartExpand,
      }),
    );
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
          excludeDescriptionRules,
        };

    const res = await fetch("/api/fetch-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Failed to create run");
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

  const activeError = localError ?? globalError;
  const isRunning =
    globalRunId !== null &&
    (globalStatus === "RUNNING" || globalStatus === "QUEUED" || globalStatus === null);

  return (
    <div className="space-y-4 px-4 py-4 lg:px-6">
      {activeError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {activeError}
        </div>
      ) : null}

      {market === "AU" && (
      <div className="space-y-4">
          {/* Primary search: job title (full width, prominent) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t("jobTitle")}</Label>
            <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
              <PopoverAnchor asChild>
                <Input
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
              <Label className="text-xs font-medium text-muted-foreground">{t("locationLabel")}</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{t("hoursOld")}</Label>
              <Select value={String(hoursOld)} onValueChange={(v) => setHoursOld(Number(v))}>
                <SelectTrigger>
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
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <ExclusionDropdown
                  label="Title exclusions"
                  values={excludeTitleTerms}
                  options={TITLE_EXCLUSION_OPTIONS}
                  placeholder="Select terms"
                  disabled={!applyExcludes}
                  testId="title-exclusions"
                  onChange={setExcludeTitleTerms}
                />

                <ExclusionDropdown
                  label="Description exclusions"
                  values={excludeDescriptionRules}
                  options={DESCRIPTION_EXCLUSION_OPTIONS}
                  placeholder="Select rules"
                  disabled={!applyExcludes}
                  testId="description-exclusions"
                  onChange={setExcludeDescriptionRules}
                />
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
    </div>
  );
}
