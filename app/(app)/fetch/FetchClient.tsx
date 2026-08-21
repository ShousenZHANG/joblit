"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useFetchStatus } from "@/app/FetchStatusContext";
import { useGuide } from "@/app/GuideContext";
import { triggerFetchRun } from "@/lib/client/triggerFetchRun";

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
] as const;

const AU_LOCATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Sydney, New South Wales, Australia", label: "Sydney" },
  { value: "Melbourne, Victoria, Australia", label: "Melbourne" },
  { value: "Brisbane, Queensland, Australia", label: "Brisbane" },
  { value: "Perth, Western Australia, Australia", label: "Perth" },
  { value: "Adelaide, South Australia, Australia", label: "Adelaide" },
  {
    value: "Canberra, Australian Capital Territory, Australia",
    label: "Canberra",
  },
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
        (option) =>
          option.label.toLowerCase().includes(query) ||
          option.value.toLowerCase().includes(query),
      )
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="h-11"
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-64 p-1">
            {list.length ? (
              <CommandGroup heading="Locations">
                {list.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
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
  const [location, setLocation] = useState(
    "Sydney, New South Wales, Australia",
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [hoursOld, setHoursOld] = useState(48);
  const [excludeSeniorTitles, setExcludeSeniorTitles] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    startRuns,
    status: fetchStatus,
    runId,
    error: fetchError,
  } = useFetchStatus();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const previousUserId = useRef<string | null>(null);

  const queries = useMemo(
    () =>
      Array.from(
        new Set(
          jobTitle
            .split(/[\n,|]/)
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ),
    [jobTitle],
  );
  const suggestionQuery = useMemo(() => {
    const segments = jobTitle.split(/[\n,|]/);
    return (segments.at(-1) ?? "").trim().toLowerCase();
  }, [jobTitle]);
  const suggestionMode = t(
    suggestionQuery.length < 2 ? "popular" : "suggestions",
  );
  const suggestions = useMemo(() => {
    if (suggestionQuery.length < 2) return COMMON_TITLES.slice(0, 12);
    return COMMON_TITLES.filter((title) =>
      title.toLowerCase().includes(suggestionQuery),
    ).slice(0, 12);
  }, [suggestionQuery]);

  useEffect(() => {
    const previous = previousUserId.current;
    if (previous && previous !== userId) {
      setLocalError(null);
      setIsSubmitting(false);
    }
    previousUserId.current = userId;
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
        excludeSeniorTitles?: boolean;
      };
      queueMicrotask(() => {
        if (cancelled) return;
        if (parsed.title) setJobTitle(parsed.title);
        if (parsed.location) setLocation(parsed.location);
        if (parsed.hoursOld) setHoursOld(parsed.hoursOld);
        if (typeof parsed.excludeSeniorTitles === "boolean") {
          setExcludeSeniorTitles(parsed.excludeSeniorTitles);
        }
      });
    } catch {
      // Ignore invalid local preferences.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        "joblit.fetch.preferences",
        JSON.stringify({
          title: jobTitle,
          location,
          hoursOld,
          excludeSeniorTitles,
        }),
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [jobTitle, location, hoursOld, excludeSeniorTitles]);

  useEffect(() => {
    if (!isSubmitting) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isSubmitting]);

  function apiErrorMessage(response: Response, json: unknown, fallback: string) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return fallback;
    const error = (json as { error?: unknown }).error;
    if (!error || typeof error !== "object" || Array.isArray(error)) {
      return fallback;
    }
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : fallback;
  }

  async function createRun(): Promise<string> {
    const response = await fetch("/api/fetch-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market: "AU",
        title: queries[0] ?? jobTitle.trim(),
        queries,
        location,
        hoursOld,
        excludeSeniorTitles,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(apiErrorMessage(response, json, "Failed to create run"));
    }
    return json.id as string;
  }

  async function onSubmit() {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (!queries.length) {
        throw new Error("Please enter at least one job title to search.");
      }
      const run = { id: await createRun(), source: "jobspy" as const };
      startRuns([run]);
      await triggerFetchRun(run, {
        errorMessage: (response, body) =>
          apiErrorMessage(response, body, "Failed to trigger run"),
      });
      markTaskComplete("first_fetch");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const activeError = localError ?? fetchError;
  const isRunning =
    runId !== null &&
    (fetchStatus === "RUNNING" ||
      fetchStatus === "QUEUED" ||
      fetchStatus === null);
  const guideHighlightClass =
    "ring-2 ring-brand-emerald-400 ring-offset-2 ring-offset-background shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";

  return (
    <div
      className="space-y-4 px-4 py-4 lg:px-6"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === "Enter" &&
          !isSubmitting &&
          !isRunning
        ) {
          event.preventDefault();
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

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label
            htmlFor="fetch-job-title"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("jobTitle")}
          </Label>
          <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
            <PopoverAnchor asChild>
              <Input
                id="fetch-job-title"
                placeholder="e.g. Software Engineer, Frontend Engineer | Backend Engineer"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => setSuggestionsOpen(false)}
                className="h-11 text-base"
              />
            </PopoverAnchor>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] p-0"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onPointerDown={(event) => event.preventDefault()}
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
                            const prefix = segments
                              .slice(0, -1)
                              .map((part) => part.trim())
                              .filter(Boolean);
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="fetch-location"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("locationLabel")}
            </Label>
            <LocationCombobox
              id="fetch-location"
              value={location}
              onChange={setLocation}
              options={AU_LOCATIONS}
              placeholder="State or city, e.g. Sydney"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="fetch-hours"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("hoursOld")}
            </Label>
            <Select
              value={String(hoursOld)}
              onValueChange={(value) => setHoursOld(Number(value))}
            >
              <SelectTrigger id="fetch-hours">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 6, 12, 24, 48, 72].map((hours) => (
                  <SelectItem key={hours} value={String(hours)}>
                    {hours} hours
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
          <label
            htmlFor="fetch-exclude-senior"
            className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-brand-emerald-200/70 bg-white/60 p-3 dark:border-brand-emerald-800/60 dark:bg-black/20"
          >
            <input
              id="fetch-exclude-senior"
              type="checkbox"
              checked={excludeSeniorTitles}
              onChange={(event) =>
                setExcludeSeniorTitles(event.target.checked)
              }
              data-testid="fetch-exclude-senior"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-600"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">
                {t("policy.excludeSenior.label")}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {t("policy.excludeSenior.hint")}
              </span>
            </span>
          </label>
        </section>

        <div className="pt-2" data-testid="fetch-actions">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || isRunning}
            className={`h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 ${
              isTaskHighlighted("first_fetch") ? guideHighlightClass : ""
            }`}
            data-guide-highlight={
              isTaskHighlighted("first_fetch") ? "true" : "false"
            }
            data-guide-anchor="first_fetch"
          >
            {isSubmitting ? (
              <Loader2
                className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            {isSubmitting ? t("fetching") : t("startFetch")}
          </Button>
        </div>
      </div>
    </div>
  );
}
