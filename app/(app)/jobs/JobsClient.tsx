"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckSquare, Compass, MapPin, RefreshCw, SlidersHorizontal, Square, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterPill } from "@/components/app-shell/FilterPill";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useFetchStatus, type FetchRunStatus } from "@/app/FetchStatusContext";

import type { JobItem, JobStatus } from "./types";
import { getErrorMessage } from "./types";
import { useJobFilters } from "./hooks/useJobFilters";
import { useJobPagination } from "./hooks/useJobPagination";
import { sessionDeletedJobIds, useJobMutations } from "./hooks/useJobMutations";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useExternalGenerate } from "./hooks/useExternalGenerate";
import { JobListItem } from "./components/JobListItem";
import { VirtualJobList } from "./components/VirtualJobList";
import { JobBatchDeleteDialog } from "./components/JobBatchDeleteDialog";
import { JobSearchBar } from "./components/JobSearchBar";
import { ExternalGenerateDialog } from "./components/ExternalGenerateDialog";
import { PdfPreviewDialog } from "./components/PdfPreviewDialog";
import { TailorReviewDialog } from "./components/TailorReviewDialog";
import { JobDetailPanel } from "./components/JobDetailPanel";
import { cn } from "@/lib/utils";
import { AU_LOCATION_OPTIONS, CN_LOCATION_OPTIONS, getUserTimeZone } from "./utils/constants";
import {
  getJobDetailsQueryKey,
  invalidateActiveJobsQueries,
  invalidateJobsQueries,
} from "./utils/jobsQueryCache";

const desktopFilterSelectTriggerClass =
  "h-11 w-full min-w-0 justify-between overflow-hidden rounded-xl border-border/80 bg-background px-3 text-sm shadow-xs transition-[background-color,border-color,box-shadow] duration-150 hover:border-brand-emerald-300 focus-visible:border-brand-emerald-500 focus-visible:ring-brand-emerald-500/20 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-left";

const mobileFilterSelectTriggerClass =
  "h-11 w-full min-w-0 justify-between overflow-hidden rounded-lg px-2.5 text-xs [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-left sm:h-9";

export function JobsClient({
  initialItems = [],
  initialCursor = null,
}: {
  initialItems?: JobItem[];
  initialCursor?: string | null;
}) {
  const { toast } = useToast();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const { runId: fetchRunId, status: fetchStatus, importedCount: fetchImportedCount } = useFetchStatus();
  const guideHighlightClass =
    "ring-2 ring-brand-emerald-500 ring-offset-2 ring-offset-background shadow-[0_0_0_4px_rgba(16,185,129,0.22)]";
  const queryClient = useQueryClient();

  const {
    q, debouncedQ, setQ,
    statusFilter, setStatusFilter,
    locationFilter, setLocationFilter,
    jobLevelFilter, setJobLevelFilter,
    market,
    queryString,
  } = useJobFilters();

  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [mobileTab, setMobileTab] = useState<"list" | "detail">("list");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [timeZone] = useState<string | null>(() => getUserTimeZone() || null);
  const [isPending, startTransition] = useTransition();
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);
  // Seed from the session tombstones so a remount (SPA nav away and back)
  // keeps already-committed deletes hidden even while a flushed DELETE is
  // still in flight — see sessionDeletedJobIds in useJobMutations.
  const [suppressedDeletedIds, setSuppressedDeletedIds] = useState<Set<string>>(
    () => new Set(sessionDeletedJobIds),
  );

  const {
    items, totalCount, nextCursor, loading, loadingInitial, showEmpty, loadingMore,
    loadedCursors, resetPagination, firstQueryError, refetch, jobLevelOptions,
  } = useJobPagination({
    queryString,
    initialItems,
    initialCursor: initialCursor ?? null,
    suppressedDeletedIds,
    scrollRef: resultsScrollRef,
  });

  const {
    updateStatus, requestDelete, batchDeleteMutation,
    updatingIds, deletingIds,
    error: mutationError, setError,
  } = useJobMutations({
    items,
    selectedId,
    setSelectedId,
    setSuppressedDeletedIds,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  // setPdfPreview is intentionally unused at the moment — `pdfPreview` is wired
  // through to PdfPreview but no caller currently triggers it. Kept here so the
  // wiring is preserved when reintroduced.
  const [pdfPreview, _setPdfPreview] = useState<{
    url: string;
    filename: string;
    label: string;
  } | null>(null);

  const ext = useExternalGenerate(setError);

  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);

  const lastSeenImportRef = useRef<{
    runId: string | null;
    status: FetchRunStatus | null;
    importedCount: number;
  } | null>(null);
  const lastImportRefreshAtRef = useRef<number>(0);

  // Reset batch mode when filters change. Uses the "store info from previous
  // renders" pattern recommended by React to adjust state during render
  // instead of in an effect, avoiding cascading renders.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevQueryStringForBatch, setPrevQueryStringForBatch] =
    useState(queryString);
  if (prevQueryStringForBatch !== queryString) {
    setPrevQueryStringForBatch(queryString);
    if (batchSelectMode) {
      setBatchSelectMode(false);
      setBatchSelectedIds(new Set());
    }
  }

  // Prune batch selections when the visible items change (e.g. after delete or
  // refetch). Compare by a content-stable id key — `items` is a fresh array
  // reference on every render (it comes from a chain of useMemos whose deps
  // include useQueries output), so reference comparison would loop forever.
  const itemsIdKey = useMemo(
    () => items.map((it) => it.id).join("|"),
    [items],
  );
  const [prevItemsIdKey, setPrevItemsIdKey] = useState(itemsIdKey);
  if (itemsIdKey !== prevItemsIdKey) {
    setPrevItemsIdKey(itemsIdKey);
    if (batchSelectMode && batchSelectedIds.size > 0) {
      const currentIds = new Set(items.map((it) => it.id));
      const pruned = new Set(
        [...batchSelectedIds].filter((id) => currentIds.has(id)),
      );
      if (pruned.size !== batchSelectedIds.size) {
        setBatchSelectedIds(pruned);
      }
    }
  }

  // Lock scroll on the app shell.
  // Re-apply after any modal closes — Radix AlertDialog temporarily sets
  // `overflow: hidden` on <body> while open, which can desync the scroll
  // state of .app-shell when the dialog unmounts.
  const anyDialogOpen =
    batchDeleteConfirmOpen ||
    previewOpen ||
    ext.externalDialogOpen ||
    !!ext.tailorReviewDraft;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    appShell.classList.add("jobs-scroll-lock");
    return () => {
      appShell.classList.remove("jobs-scroll-lock");
    };
  }, [anyDialogOpen]);

  // Cleanup PDF object URL
  useEffect(() => {
    return () => {
      if (pdfPreview?.url) {
        URL.revokeObjectURL(pdfPreview.url);
      }
    };
  }, [pdfPreview?.url]);

  const reducedMotion = useReducedMotion();
  const showLoadingOverlay = (loading && !loadingMore) || isPending;
  // Keep the list near-solid during loads/transitions — with keepPreviousData
  // holding the previous rows, a heavy dim just reads as a flicker on fast
  // filter switches. A barely-there fade still signals "working".
  const listOpacityClass = showLoadingOverlay ? "opacity-95" : "opacity-100";
  const queryError = firstQueryError
    ? getErrorMessage(firstQueryError, t("errorLoadJobs"))
    : null;
  // A query error gets a Retry affordance (wired to the infinite query refetch);
  // a mutation error gets a dismiss (X) — mirrors TailorClient's banner.
  const activeError = mutationError ?? queryError;
  const activeErrorKind: "query" | "mutation" | null = mutationError
    ? "mutation"
    : queryError
      ? "query"
      : null;

  const activeFilterCount = [
    locationFilter !== "ALL",
    jobLevelFilter !== "ALL",
    statusFilter !== "NEW",
  ].filter(Boolean).length;

  function triggerSearch() {
    invalidateJobsQueries(queryClient);
  }

  // Auto-refresh on fetch import changes
  useEffect(() => {
    const current = {
      runId: fetchRunId ?? null,
      status: (fetchStatus ?? null) as FetchRunStatus | null,
      importedCount: typeof fetchImportedCount === "number" ? fetchImportedCount : 0,
    };
    const previous = lastSeenImportRef.current;
    lastSeenImportRef.current = current;

    if (!current.runId || !current.status) return;
    if (!previous || previous.runId !== current.runId) return;

    const delta = current.importedCount - previous.importedCount;
    if (delta <= 0) return;

    const isTerminal = current.status === "SUCCEEDED" || current.status === "FAILED";
    const wasTerminal = previous.status === "SUCCEEDED" || previous.status === "FAILED";
    const justBecameTerminal = isTerminal && !wasTerminal;
    const isFirstPage = loadedCursors.length === 1 && loadedCursors[0] === null;
    const inProgress = current.status === "RUNNING" || current.status === "QUEUED";

    if (!justBecameTerminal && !(inProgress && isFirstPage)) return;

    if (!justBecameTerminal) {
      const now = Date.now();
      if (now - lastImportRefreshAtRef.current < 5000) return;
      lastImportRefreshAtRef.current = now;
    }

    resetPagination();
    invalidateActiveJobsQueries(queryClient);

    if (justBecameTerminal) {
      toast({
        title: t("importedToastTitle"),
        description: t("importedToastDesc", { delta }),
        duration: 2200,
        className:
          "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
      });
    }
  }, [
    fetchImportedCount,
    fetchRunId,
    fetchStatus,
    loadedCursors,
    queryClient,
    resetPagination,
    t,
    toast,
  ]);

  function toggleBatchSelect(id: string) {
    setBatchSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (batchSelectedIds.size === items.length) {
      setBatchSelectedIds(new Set());
    } else {
      setBatchSelectedIds(new Set(items.map((it) => it.id)));
    }
  }

  function exitBatchMode() {
    setBatchSelectMode(false);
    setBatchSelectedIds(new Set());
  }

  function confirmBatchDelete() {
    const ids = [...batchSelectedIds].filter((id) => !deletingIds.has(id));
    if (ids.length > 0) {
      batchDeleteMutation.mutate(ids);
    }
    setBatchDeleteConfirmOpen(false);
    exitBatchMode();
  }

  const effectiveSelectedId = useMemo(() => {
    if (!items.length) return null;
    if (selectedId && items.some((it) => it.id === selectedId)) return selectedId;
    return items[0]?.id ?? null;
  }, [items, selectedId]);

  const handleSelectJob = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id !== null) {
      markTaskComplete("review_jobs");
    }
    if (id !== null && typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileTab("detail");
    }
  }, [markTaskComplete]);

  useKeyboardNavigation({
    items,
    selectedId: effectiveSelectedId,
    onSelect: handleSelectJob,
  });

  const selectedJob = items.find((it) => it.id === effectiveSelectedId) ?? null;
  const selectedTailorSource = selectedJob ? ext.tailorSourceByJob[selectedJob.id] : undefined;
  const highlightGenerate = isTaskHighlighted("generate_first_pdf");

  const detailQuery = useQuery({
    queryKey: getJobDetailsQueryKey(effectiveSelectedId),
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${effectiveSelectedId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t("errorLoadDetails"));
      return json as { id: string; description: string | null };
    },
    enabled: Boolean(effectiveSelectedId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const selectedDescription = selectedJob ? detailQuery.data?.description ?? "" : "";
  const detailError = detailQuery.error
    ? getErrorMessage(detailQuery.error, t("errorLoadDetails"))
    : null;
  const detailLoading = detailQuery.isFetching && !detailQuery.data;

  return (
    <>
      <ExternalGenerateDialog
        open={ext.externalDialogOpen}
        onOpenChange={ext.setExternalDialogOpen}
        dialogPhase={ext.dialogPhase}
        setDialogPhase={ext.setDialogPhase}
        externalTarget={ext.externalTarget}
        externalStep={ext.externalStep}
        setExternalStep={ext.setExternalStep}
        externalSkillPackFresh={ext.externalSkillPackFresh}
        setExternalSkillPackFresh={ext.setExternalSkillPackFresh}
        externalSkillPackLoading={ext.externalSkillPackLoading}
        externalPromptLoading={ext.externalPromptLoading}
        externalPromptMeta={ext.externalPromptMeta}
        externalPromptText={ext.externalPromptText}
        externalShortPromptText={ext.externalShortPromptText}
        promptCopied={ext.promptCopied}
        externalModelOutput={ext.externalModelOutput}
        setExternalModelOutput={ext.setExternalModelOutput}
        externalGenerating={ext.externalGenerating}
        parsedExternalOutput={ext.parsedExternalOutput}
        selectedJob={selectedJob}
        onCopySmartPrompt={ext.copySmartPrompt}
        onDownloadSkillPack={ext.downloadSkillPack}
        onGenerate={ext.generateFromImportedJson}
      />

      <TailorReviewDialog
        open={!!ext.tailorReviewDraft}
        draft={ext.tailorReviewDraft}
        onOpenChange={(open) => {
          if (!open) ext.closeTailorReview();
        }}
        onFinalized={ext.handleTailorReviewFinalized}
      />

      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        pdfPreview={pdfPreview}
      />

      <div
        data-testid="jobs-shell"
        className="edu-page-enter relative flex flex-1 flex-col gap-2 pb-0 text-foreground lg:min-h-0 lg:h-full lg:overflow-hidden"
      >
      <div className="flex flex-1 flex-col gap-2 lg:min-h-0 lg:h-full lg:overflow-hidden">
        <div aria-live="polite" className="sr-only">
          {totalCount !== undefined ? t("jobsFound", { count: totalCount }) : t("loadingJobs")}
        </div>
        {/* Mobile-only toolbar. Desktop search/filter row was moved
            into the results (list) column header to match the
            reference layout and reclaim vertical space for the detail
            pane. See the desktop-only block further down. */}
        <div
        role="search"
        aria-label={t("searchLandmark")}
        data-testid="jobs-toolbar"
        className="relative rounded-2xl border border-border/70 bg-background/90 p-3 shadow-sm backdrop-blur lg:hidden"
      >
        {loading ? (
          <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden rounded-t-2xl">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-brand-emerald-500 to-transparent" />
          </div>
        ) : null}

        {/* Mobile: compact search + filter toggle */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <JobSearchBar
                q={q}
                onQueryChange={setQ}
                onSubmit={triggerSearch}
                placeholder={t("placeholder")}
                isDebouncing={q !== "" && q !== debouncedQ}
              />
            </div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:h-9",
                mobileFiltersOpen
                  ? "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-700"
                  : "border-border bg-background text-foreground/70",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-emerald-500 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {mobileFiltersOpen && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/40 p-2.5">
              <Select
                value={locationFilter}
                onValueChange={(v) => { startTransition(() => { setLocationFilter(v); }); }}
              >
                <SelectTrigger
                  className={cn(mobileFilterSelectTriggerClass, "gap-1.5")}
                  aria-label={t("location")}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <SelectValue placeholder={tc("allLocations")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("allLocations")}</SelectItem>
                  {(market === "CN" ? CN_LOCATION_OPTIONS : AU_LOCATION_OPTIONS).map((loc) => (
                    <SelectItem key={loc.value} value={loc.value}>{loc.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={jobLevelFilter}
                onValueChange={(v) => { startTransition(() => { setJobLevelFilter(v); }); }}
              >
                <SelectTrigger
                  className={mobileFilterSelectTriggerClass}
                  aria-label={t("jobLevel")}
                >
                  <SelectValue placeholder={tc("allLevels")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("allLevels")}</SelectItem>
                  {jobLevelOptions.map((level) => (
                    <SelectItem key={level} value={level}>{level}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(v) => { startTransition(() => { setStatusFilter(v as JobStatus); }); }}
              >
                <SelectTrigger
                  className={mobileFilterSelectTriggerClass}
                  aria-label={t("status")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEW">{t("statusNew")}</SelectItem>
                  <SelectItem value="APPLIED">{t("statusApplied")}</SelectItem>
                  <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

      </div>

      {activeError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span className="min-w-0">{activeError}</span>
          {activeErrorKind === "query" ? (
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={loading}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "motion-safe:animate-spin")}
                aria-hidden
              />
              {tc("retry")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={tc("close")}
              className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-destructive/15"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      ) : null}

        <section className="relative flex flex-1 flex-col gap-3 lg:grid lg:min-h-0 lg:h-full lg:grid-cols-[380px_1fr] lg:items-stretch">
        <div
          className="flex shrink-0 items-center rounded-lg bg-muted/70 p-0.5 lg:hidden"
          role="tablist"
          aria-label={t("mobileTablistLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "list"}
            onClick={() => setMobileTab("list")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 min-h-[44px]",
              mobileTab === "list"
                ? "bg-background text-brand-emerald-700 shadow-sm"
                : "text-muted-foreground active:bg-background/60",
            )}
          >
            {tn("jobs")}
            <span className="ml-1 text-[10px] font-normal opacity-70">
              {typeof totalCount === "number" ? totalCount : items.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "detail"}
            onClick={() => setMobileTab("detail")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 min-h-[44px]",
              mobileTab === "detail"
                ? "bg-background text-brand-emerald-700 shadow-sm"
                : "text-muted-foreground active:bg-background/60",
            )}
          >
            {t("tabDetail")}
          </button>
        </div>

        {/* Results panel */}
        <div
          data-testid="jobs-results-panel"
          className={cn(
            "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
            "rounded-2xl border border-border/70 bg-background/90 shadow-sm",
            "lg:rounded-3xl lg:border-2 lg:border-border/50 lg:bg-background/85 lg:shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] lg:hover:shadow-[0_24px_50px_-36px_rgba(5,150,105,0.22)]",
            "min-h-[clamp(18rem,calc(100dvh-16rem),32rem)] max-h-[calc(100dvh-12rem)] lg:h-auto lg:min-h-0 lg:max-h-none lg:flex-1",
            mobileTab !== "list" && "hidden lg:flex",
          )}
        >
          {/* Desktop toolbar — lives inside the list column (not above
              the two-pane grid) so the detail pane stretches full
              height. Compact three-row stack tuned for the 380px
              column width. */}
          <div className="hidden shrink-0 border-b border-border/60 p-3 lg:block">
            {loading ? (
              <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden">
                <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-brand-emerald-500 to-transparent" />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <JobSearchBar
                q={q}
                onQueryChange={setQ}
                onSubmit={triggerSearch}
                placeholder={t("placeholder")}
                isDebouncing={q !== "" && q !== debouncedQ}
              />
              <div
                data-testid="jobs-desktop-filter-row"
                className={cn(
                  "grid min-w-0 items-center gap-2",
                  market === "AU"
                    ? "grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_4.75rem]"
                    : "grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]",
                )}
              >
                <Select
                  value={locationFilter}
                  onValueChange={(v) => {
                    startTransition(() => {
                      setLocationFilter(v);
                    });
                  }}
                >
                  <SelectTrigger
                    data-testid="jobs-location-filter"
                    className={cn(desktopFilterSelectTriggerClass, "gap-1.5")}
                    aria-label={t("location")}
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <SelectValue placeholder={tc("allLocations")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{tc("allLocations")}</SelectItem>
                    {(market === "CN"
                      ? CN_LOCATION_OPTIONS
                      : AU_LOCATION_OPTIONS
                    ).map((loc) => (
                      <SelectItem key={loc.value} value={loc.value}>
                        {loc.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={jobLevelFilter}
                  onValueChange={(v) => {
                    startTransition(() => {
                      setJobLevelFilter(v);
                    });
                  }}
                >
                  <SelectTrigger
                    data-testid="jobs-level-filter"
                    className={desktopFilterSelectTriggerClass}
                    aria-label={t("jobLevel")}
                  >
                    <SelectValue placeholder={tc("allLevels")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{tc("allLevels")}</SelectItem>
                    {jobLevelOptions.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {batchSelectMode ? (
            <div className="flex items-center justify-between border-b bg-brand-emerald-50/60 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground/90 transition-colors hover:bg-brand-emerald-100"
                  aria-label={batchSelectedIds.size === items.length ? t("deselectAll") : t("selectAll")}
                >
                  {batchSelectedIds.size === items.length ? (
                    <CheckSquare className="h-4 w-4 text-brand-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                  {batchSelectedIds.size > 0 ? (
                    <span className="font-semibold text-brand-emerald-700">{t("selectedCount", { count: batchSelectedIds.size })}</span>
                  ) : (
                    <span>{t("selectAll")}</span>
                  )}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={batchSelectedIds.size === 0}
                  onClick={() => setBatchDeleteConfirmOpen(true)}
                  className="flex items-center gap-1 rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground shadow-sm transition-all duration-150 hover:bg-destructive/90 active:translate-y-px disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {tc("delete")}
                </button>
                <button
                  type="button"
                  onClick={exitBatchMode}
                  className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t("exitSelectionMode")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="border-b">
              <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
                <span>
                  {t("results")}
                  {typeof totalCount === "number" ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      · {t("jobCount", { count: totalCount })}
                    </span>
                  ) : null}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("loadedCount", { count: items.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBatchSelectMode(true)}
                    className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("enterSelectionMode")}
                  >
                    <CheckSquare className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {/* Status filter pills — horizontal-scroll row beneath the
                  Results header so status filtering is one click away
                  instead of buried in a select dropdown. */}
              <div className="no-scrollbar -mt-1 flex items-center gap-1.5 overflow-x-auto px-4 pb-3">
                <FilterPill
                  active={statusFilter === "NEW"}
                  onClick={() =>
                    startTransition(() => setStatusFilter("NEW"))
                  }
                >
                  {t("statusNew")}
                </FilterPill>
                <FilterPill
                  active={statusFilter === "APPLIED"}
                  onClick={() =>
                    startTransition(() => setStatusFilter("APPLIED"))
                  }
                >
                  {t("statusApplied")}
                </FilterPill>
                <FilterPill
                  active={statusFilter === "REJECTED"}
                  onClick={() =>
                    startTransition(() => setStatusFilter("REJECTED"))
                  }
                >
                  {t("statusRejected")}
                </FilterPill>
              </div>
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <ScrollArea
            ref={resultsScrollRef}
            type="scroll"
            data-testid="jobs-results-scroll"
            data-loading={showLoadingOverlay ? "true" : "false"}
            data-virtual={items.length > 80 ? "true" : "false"}
            className={`jobs-scroll-area max-h-full flex-1 min-h-0 transition-opacity duration-200 ease-out ${listOpacityClass}`}
          >
            {loadingInitial ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={`s-${idx}`} className="rounded-lg border p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="mt-2 h-3 w-1/2" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                  </div>
                ))}
              </div>
            ) : null}
            {items.length > 0 ? (
              items.length > 80 ? (
                <VirtualJobList
                  items={items}
                  effectiveSelectedId={effectiveSelectedId}
                  onSelect={handleSelectJob}
                  timeZone={timeZone}
                  scrollRootRef={resultsScrollRef}
                  batchMode={batchSelectMode}
                  batchSelectedIds={batchSelectedIds}
                  onBatchToggle={toggleBatchSelect}
                />
              ) : (
                <div className="space-y-3 p-3">
                  {items.map((it) => {
                    const row = (
                      <JobListItem
                        job={it}
                        isActive={it.id === effectiveSelectedId}
                        onSelect={() => handleSelectJob(it.id)}
                        timeZone={timeZone}
                        batchMode={batchSelectMode}
                        batchSelected={batchSelectedIds.has(it.id)}
                        onBatchToggle={toggleBatchSelect}
                      />
                    );
                    // `layout="position"` slides the surviving rows up smoothly
                    // when one above is deleted (and reorders), instead of a
                    // hard snap — the "silky update" the bare list lacked. No
                    // AnimatePresence/exit so deleted rows still unmount
                    // immediately (keeps delete/undo behavior + tests intact).
                    return reducedMotion ? (
                      <div key={it.id}>{row}</div>
                    ) : (
                      <motion.div
                        key={it.id}
                        layout="position"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {row}
                      </motion.div>
                    );
                  })}
                </div>
              )
            ) : showEmpty ? (
              <div className="flex h-full min-h-[440px] flex-col items-center justify-center px-6 py-12 text-center">
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center"
                >
                  {/* Layered emblem: soft glow + concentric rings + a crisp tile */}
                  <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-brand-emerald-400/20 blur-2xl"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full ring-1 ring-brand-emerald-100"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-[7px] rounded-full ring-1 ring-brand-emerald-100/70"
                    />
                    {!reducedMotion && (
                      <span
                        aria-hidden
                        className="absolute inset-0 rounded-full ring-1 ring-brand-emerald-300/50 motion-safe:animate-ping [animation-duration:3s]"
                      />
                    )}
                    <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-emerald-50 to-white text-brand-emerald-600 shadow-sm ring-1 ring-brand-emerald-100">
                      <Compass className="h-6 w-6" aria-hidden />
                    </span>
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    {activeFilterCount > 0 ? t("emptyHeadlineFiltered") : t("emptyHeadline")}
                  </h3>
                  <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
                    {activeFilterCount > 0 ? t("emptySubtextFiltered") : t("emptySubtext")}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                    <Button
                      asChild
                      size="sm"
                      className="group h-10 gap-1.5 rounded-full bg-brand-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-emerald-700 hover:shadow-md"
                    >
                      <Link href="/fetch">
                        {t("emptyFetchCta")}
                        <ArrowRight
                          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </Link>
                    </Button>
                    {activeFilterCount > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          startTransition(() => {
                            setStatusFilter("NEW");
                            setLocationFilter("ALL");
                            setJobLevelFilter("ALL");
                            setQ("");
                          })
                        }
                        className="h-10 rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
                      >
                        {t("emptyClearFilters")}
                      </Button>
                    )}
                  </div>
                </motion.div>
              </div>
            ) : null}
          </ScrollArea>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {loadingMore ? (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 motion-safe:animate-spin rounded-full border-2 border-brand-emerald-500 border-t-transparent" />
                <span>{t("loadingMore")}</span>
              </div>
            ) : nextCursor ? (
              t("scrollToLoadMore")
            ) : (
              t("endOfResults")
            )}
          </div>
        </div>

        {/* Detail panel */}
        <JobDetailPanel
          selectedJob={selectedJob}
          selectedDescription={selectedDescription}
          detailError={detailError}
          detailLoading={detailLoading}
          showLoadingOverlay={showLoadingOverlay}
          tailorSource={selectedTailorSource}
          updatingIds={updatingIds}
          deletingIds={deletingIds}
          highlightGenerate={highlightGenerate}
          guideHighlightClass={guideHighlightClass}
          externalPromptLoading={ext.externalPromptLoading}
          mobileTab={mobileTab}
          onUpdateStatus={updateStatus}
          onDelete={requestDelete}
          onGenerateResume={(job) => ext.openExternalGenerateDialog(job, "resume")}
          onGenerateCover={(job) => ext.openExternalGenerateDialog(job, "cover")}
          onRetryDetail={() => void detailQuery.refetch()}
        />
        </section>
      </div>
      </div>
      <JobBatchDeleteDialog
        open={batchDeleteConfirmOpen}
        onOpenChange={setBatchDeleteConfirmOpen}
        count={batchSelectedIds.size}
        onConfirm={confirmBatchDelete}
        cancelLabel={tc("cancel")}
      />
    </>
  );
}
