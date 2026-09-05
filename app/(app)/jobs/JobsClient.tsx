"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/api/fetchJson";
import { jobDetailResponseSchema } from "@/lib/shared/schemas/jobsList";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  MapPin,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibleTabs } from "@/components/ui/useAccessibleTabs";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useFetchStatus, type FetchRunStatus } from "@/app/FetchStatusContext";

import { JOB_STATUS_LABEL_KEYS, type JobItem, type JobStatus } from "./types";
import { ACTIVE_JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";
import { SegmentedControl } from "@/components/app-shell/SegmentedControl";
import { getErrorMessage } from "./types";
import { useJobFilters } from "./hooks/useJobFilters";
import { useJobPagination } from "./hooks/useJobPagination";
import { useSuppressedJobRows } from "./hooks/useSuppressedJobRows";
import { useJobMutations } from "./hooks/useJobMutations";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useTailorReviewController } from "./hooks/useTailorReviewController";
import { JobListItem } from "./components/JobListItem";
import {
  VirtualJobList,
  type VirtualJobListHandle,
} from "./components/VirtualJobList";
import { JobSearchBar } from "./components/JobSearchBar";
import { TailorDialog } from "./components/tailoring/TailorDialog";
import { JobDetailPanel } from "./components/JobDetailPanel";
import { cn } from "@/lib/utils";
import {
  getUserTimeZone,
} from "./utils/constants";
import type { JobsUrlState } from "./utils/jobsUrlState";
import {
  getJobDetailsQueryKey,
  invalidateActiveJobsQueries,
  invalidateJobsQueries,
} from "./utils/jobsQueryCache";

const desktopFilterSelectTriggerClass =
  "h-11 w-full min-w-0 justify-between overflow-hidden rounded-xl border-border/80 bg-background px-3 text-sm shadow-xs transition-[background-color,border-color,box-shadow] duration-150 hover:border-brand-emerald-300 focus-visible:border-brand-emerald-500 focus-visible:ring-brand-emerald-500/20 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-left";

const mobileFilterSelectTriggerClass =
  "h-11 w-full min-w-0 justify-between overflow-hidden rounded-lg px-2.5 text-xs [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-left sm:h-9";

/**
 * One list row, memoized as a unit INCLUDING its motion wrapper.
 *
 * Two things made typing in the search box drop frames: every keystroke
 * re-rendered JobsClient, and (a) each row's inline `onSelect={() => ...}`
 * closure defeated JobListItem's React.memo, (b) each row's motion.div
 * re-rendered and re-measured layout for 60+ rows. Memoizing at this level
 * with stable props skips both. The per-row entrance fade is gone with it —
 * a full list swap animating every row at once read as stutter, not polish.
 * `layout="position"` stays: rows sliding up when one above is deleted is
 * the one motion that carries information.
 */
const JobRow = React.memo(function JobRow({
  job,
  isActive,
  onSelectJob,
  timeZone,
  reducedMotion,
}: {
  job: JobItem;
  isActive: boolean;
  onSelectJob: (id: string | null) => void;
  timeZone: string | null;
  reducedMotion: boolean | null;
}) {
  const row = (
    <JobListItem
      job={job}
      isActive={isActive}
      onSelectJob={onSelectJob}
      timeZone={timeZone}
    />
  );
  return reducedMotion ? (
    <div>{row}</div>
  ) : (
    <motion.div
      layout="position"
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {row}
    </motion.div>
  );
});

function getWorkspaceStateKey(
  state: Pick<JobsUrlState, "selectedId" | "view">,
) {
  return `${state.selectedId ?? ""}\u0000${state.view}`;
}

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
  const {
    runId: fetchRunId,
    status: fetchStatus,
    importedCount: fetchImportedCount,
  } = useFetchStatus();
  const guideHighlightClass =
    "ring-2 ring-brand-emerald-500 ring-offset-2 ring-offset-background shadow-[0_0_0_4px_rgba(16,185,129,0.22)]";
  const queryClient = useQueryClient();
  const tailorReview = useTailorReviewController();
  const { cancelTailorDialog, openTailorDialog } = tailorReview;

  const {
    q,
    debouncedQ,
    setQ,
    statusFilter,
    setStatusFilter,
    market,
    queryString,
    urlState,
    replaceUrlStateShallow,
  } = useJobFilters();
  const urlSelectedId = urlState.selectedId;
  const urlView = urlState.view;

  const [selectedId, setSelectedId] = useState<string | null>(
    () => urlSelectedId ?? initialItems[0]?.id ?? null,
  );
  const [selectionExplicitlyCleared, setSelectionExplicitlyCleared] =
    useState(false);
  const [mobileTab, setMobileTab] = useState<"list" | "detail">(() => urlView);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [timeZone] = useState<string | null>(() => getUserTimeZone() || null);
  const [isPending, startTransition] = useTransition();
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);
  const jobListRef = useRef<HTMLDivElement>(null);
  const virtualJobListRef = useRef<VirtualJobListHandle>(null);
  const pendingWorkspaceUrlRef = useRef<string | null>(null);
  const workspaceUrlInitializedRef = useRef(false);
  const { suppressedDeletedIds, hideJobs, revealJobs, restoreAnchor } =
    useSuppressedJobRows({ scrollRef: resultsScrollRef });
  // Every workspace-URL write goes through the shallow (history) path — there
  // is deliberately no router.replace variant. Nothing the server renders
  // depends on the selected row or the mobile pane, but `/jobs` is
  // force-dynamic: a router.replace re-runs the page's server component, which
  // re-seeds ONE page of rows and re-hydrates it over the infinite query with a
  // fresher timestamp. Every page the user scrolled in is discarded, so
  // selecting a row mid-triage snapped the list back to ten rows and threw the
  // scroll position away. `pendingWorkspaceUrlRef` records what we wrote so the
  // URL->state effect below can tell our own write from a genuine external
  // change (back/forward, or the debounced filter sync republishing the merged
  // URL) and leave the state we just set alone.
  const persistWorkspaceUrl = useCallback(
    (patch: Partial<Pick<JobsUrlState, "selectedId" | "view">>) => {
      const nextState = replaceUrlStateShallow(patch);
      if (nextState) {
        pendingWorkspaceUrlRef.current = getWorkspaceStateKey(nextState);
      }
    },
    [replaceUrlStateShallow],
  );
  const setSelectedIdFromMutation = useCallback(
    (id: string | null) => {
      cancelTailorDialog();
      setSelectionExplicitlyCleared(false);
      setSelectedId(id);
      persistWorkspaceUrl({ selectedId: id });
    },
    [cancelTailorDialog, persistWorkspaceUrl],
  );

  useEffect(() => {
    if (!workspaceUrlInitializedRef.current) {
      workspaceUrlInitializedRef.current = true;
      return;
    }

    const incomingKey = getWorkspaceStateKey({
      selectedId: urlSelectedId,
      view: urlView,
    });
    if (pendingWorkspaceUrlRef.current === incomingKey) {
      pendingWorkspaceUrlRef.current = null;
      return;
    }

    pendingWorkspaceUrlRef.current = null;
    cancelTailorDialog();
    setSelectionExplicitlyCleared(false);
    setSelectedId(urlSelectedId);
    setMobileTab(urlView);
  }, [cancelTailorDialog, urlSelectedId, urlView]);

  const {
    items,
    totalCount,
    nextCursor,
    loading,
    loadingInitial,
    showEmpty,
    loadingMore,
    loadedCursors,
    resetPagination,
    firstQueryError,
    refetch,
  } = useJobPagination({
    queryString,
    initialItems,
    initialCursor: initialCursor ?? null,
    suppressedDeletedIds,
    scrollRef: resultsScrollRef,
  });
  const visibleItems = items;

  const {
    updateStatus,
    requestDelete,
    updatingIds,
    deletingIds,
    error: mutationError,
    setError,
  } = useJobMutations({
    items: visibleItems,
    selectedId,
    setSelectedId: setSelectedIdFromMutation,
    hideJobs,
    revealJobs,
  });

  // Keep renderer identity stable after virtualization first becomes useful.
  // In particular, deleting row 81 must not swap the entire virtual subtree
  // for the ordinary renderer when the visible count becomes 80.
  const [virtualListEnabled, setVirtualListEnabled] = useState(
    initialItems.length > 80,
  );
  if (!virtualListEnabled && visibleItems.length > 80) {
    setVirtualListEnabled(true);
  }
  const visibleItemsIdKey = useMemo(
    () => visibleItems.map((item) => item.id).join("|"),
    [visibleItems],
  );

  // Restore the first surviving visible row to the same viewport offset. This
  // works for ordinary and virtual rows and avoids scroll/pointer displacement
  // when a row above the pointer disappears or reappears after rollback.
  useLayoutEffect(restoreAnchor, [restoreAnchor, visibleItemsIdKey]);

  const lastSeenImportRef = useRef<{
    runId: string | null;
    status: FetchRunStatus | null;
    importedCount: number;
  } | null>(null);
  const lastImportRefreshAtRef = useRef<number>(0);

  // Lock scroll on the app shell.
  // Re-apply after any modal closes — Radix AlertDialog temporarily sets
  // `overflow: hidden` on <body> while open, which can desync the scroll
  // state of .app-shell when the dialog unmounts.
  const anyDialogOpen = !!tailorReview.session;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    appShell.classList.add("jobs-scroll-lock");
    return () => {
      appShell.classList.remove("jobs-scroll-lock");
    };
  }, [anyDialogOpen]);

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

  const activeFilterCount = [statusFilter !== "NEW"].filter(Boolean).length;

  function triggerSearch() {
    invalidateJobsQueries(queryClient);
  }

  // Auto-refresh on fetch import changes
  useEffect(() => {
    const current = {
      runId: fetchRunId ?? null,
      status: (fetchStatus ?? null) as FetchRunStatus | null,
      importedCount:
        typeof fetchImportedCount === "number" ? fetchImportedCount : 0,
    };
    const previous = lastSeenImportRef.current;
    lastSeenImportRef.current = current;

    if (!current.runId || !current.status) return;
    if (!previous || previous.runId !== current.runId) return;

    const isTerminal =
      current.status === "SUCCEEDED" ||
      current.status === "PARTIAL" ||
      current.status === "FAILED";
    const wasTerminal =
      previous.status === "SUCCEEDED" ||
      previous.status === "PARTIAL" ||
      previous.status === "FAILED";
    const justBecameTerminal = isTerminal && !wasTerminal;
    const isFirstPage = loadedCursors.length === 1 && loadedCursors[0] === null;
    const inProgress =
      current.status === "RUNNING" || current.status === "QUEUED";
    const delta = current.importedCount - previous.importedCount;

    // A terminal transition invalidates every loaded page even when the final
    // poll repeats the last RUNNING count. Otherwise page 2 can stay stale
    // forever after the imported count advanced on an earlier poll.
    if (!justBecameTerminal && delta <= 0) return;
    if (!justBecameTerminal && !(inProgress && isFirstPage)) return;

    if (!justBecameTerminal) {
      const now = Date.now();
      if (now - lastImportRefreshAtRef.current < 5000) return;
      lastImportRefreshAtRef.current = now;
    }

    resetPagination();
    invalidateActiveJobsQueries(queryClient);

    if (justBecameTerminal && delta > 0) {
      const isPartial = current.status === "PARTIAL";
      toast({
        title: t(isPartial ? "partialImportToastTitle" : "importedToastTitle"),
        description: t(
          isPartial ? "partialImportToastDesc" : "importedToastDesc",
          { delta },
        ),
        duration: 2200,
        className: isPartial
          ? "border-[var(--tier-fair-ring)] bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)] animate-in fade-in zoom-in-95"
          : "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
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

  // Stable handler for the memoized detail panel — an inline lambda in the
  // JSX would give it fresh props on every keystroke and defeat the memo.
  const handleTailor = useCallback(
    (job: JobItem, target: "resume" | "cover") => openTailorDialog(job, target),
    [openTailorDialog],
  );

  const effectiveSelectedId = useMemo(() => {
    if (selectionExplicitlyCleared) return null;
    if (!visibleItems.length) return null;
    if (selectedId && visibleItems.some((item) => item.id === selectedId)) {
      return selectedId;
    }
    return visibleItems[0]?.id ?? null;
  }, [selectedId, selectionExplicitlyCleared, visibleItems]);

  // Selection can also change implicitly when filters remove the active row.
  // A layout effect closes that final context-change gap before a stale review
  // response can paint an editor for the job that just disappeared.
  useLayoutEffect(() => {
    cancelTailorDialog();
  }, [cancelTailorDialog, effectiveSelectedId]);

  const handleSelectJob = useCallback(
    (id: string | null) => {
      cancelTailorDialog();
      const showDetail =
        id !== null &&
        typeof window !== "undefined" &&
        window.innerWidth < 1024;
      setSelectionExplicitlyCleared(id === null);
      setSelectedId(id);
      if (id !== null) {
        markTaskComplete("review_jobs");
      }
      if (showDetail) {
        setMobileTab("detail");
      }
      persistWorkspaceUrl({
        selectedId: id,
        ...(showDetail ? { view: "detail" as const } : {}),
      });
    },
    [cancelTailorDialog, markTaskComplete, persistWorkspaceUrl],
  );

  const handleMobileTabChange = useCallback(
    (view: "list" | "detail") => {
      setMobileTab(view);
      persistWorkspaceUrl({ view });
    },
    [persistWorkspaceUrl],
  );

  const mobileTabs = useAccessibleTabs({
    id: "jobs-mobile",
    value: mobileTab,
    values: ["list", "detail"] as const,
    onValueChange: handleMobileTabChange,
  });

  const prepareRowFocus = useCallback((index: number) => {
    virtualJobListRef.current?.scrollToIndex(index);
  }, []);

  useKeyboardNavigation({
    containerRef: jobListRef,
    items: visibleItems,
    selectedId: effectiveSelectedId,
    onSelect: handleSelectJob,
    prepareRowFocus,
  });

  const selectedJob =
    visibleItems.find((item) => item.id === effectiveSelectedId) ?? null;
  const selectedTailorSource = selectedJob
    ? tailorReview.tailorSourceByJob[selectedJob.id]
    : undefined;
  const highlightGenerate = isTaskHighlighted("generate_first_pdf");

  const detailQuery = useQuery({
    queryKey: getJobDetailsQueryKey(effectiveSelectedId),
    queryFn: async () => {
      return await fetchJson(`/api/jobs/${effectiveSelectedId}`, {
        fallbackError: t("errorLoadDetails"),
        schema: jobDetailResponseSchema,
      });
    },
    enabled: Boolean(effectiveSelectedId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const {
    data: detailData,
    error: detailQueryError,
    isFetching: detailIsFetching,
    refetch: refetchDetail,
  } = detailQuery;
  // Never pair a cached/placeholder detail payload with a different selected
  // row. Experience offsets are source-specific, so even a brief cross-job
  // render would show the wrong summary and disable trustworthy highlighting.
  const selectedDetailData =
    detailData?.id === selectedJob?.id ? detailData : undefined;
  const detailRefetchKeyRef = useRef<string | null>(null);
  const selectedDescription = selectedDetailData?.description ?? "";
  const selectedJobId = selectedJob?.id;
  const selectedJobVersion = selectedJob?.updatedAt;
  // The list and detail have different cache lifetimes. Compare row versions
  // so a status update refreshes the detail instead of pairing the new row
  // with a stale detail payload for up to five minutes.
  useEffect(() => {
    const versionChanged =
      Boolean(selectedDetailData?.updatedAt) &&
      selectedDetailData?.updatedAt !== selectedJobVersion;
    if (selectedJobId && versionChanged && !detailIsFetching) {
      const key = `${selectedJobId}:${selectedJobVersion}`;
      if (detailRefetchKeyRef.current === key) return;
      detailRefetchKeyRef.current = key;
      void refetchDetail();
    }
  }, [
    selectedDetailData?.updatedAt,
    detailIsFetching,
    refetchDetail,
    selectedJobId,
    selectedJobVersion,
  ]);
  const detailError = detailQueryError
    ? getErrorMessage(detailQueryError, t("errorLoadDetails"))
    : null;
  const detailLoading = detailIsFetching && !selectedDetailData;
  return (
    <>
      <TailorDialog
        job={tailorReview.session?.job ?? null}
        initialTarget={tailorReview.session?.target ?? "resume"}
        draft={tailorReview.draft}
        draftLoading={tailorReview.draftLoading}
        draftError={tailorReview.draftError}
        onOpenChange={(open) => {
          if (!open) tailorReview.cancelTailorDialog();
        }}
        onImported={tailorReview.handleImported}
        onFinalized={tailorReview.handleFinalized}
      />

      <div
        data-testid="jobs-shell"
        className="relative flex flex-1 flex-col gap-2 pb-0 text-foreground lg:min-h-0 lg:h-full lg:overflow-hidden"
      >
        <div className="flex flex-1 flex-col gap-2 lg:min-h-0 lg:h-full lg:overflow-hidden">
          <div aria-live="polite" className="sr-only">
            {totalCount !== undefined
              ? t("jobsFound", { count: totalCount })
              : t("loadingJobs")}
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
                    "flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors",
                    mobileFiltersOpen
                      ? "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-text"
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
                <div className="rounded-lg border border-border/60 bg-muted/40 p-2.5">
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => {
                      startTransition(() => {
                        setStatusFilter(v as JobStatus);
                      });
                    }}
                  >
                    <SelectTrigger
                      className={mobileFilterSelectTriggerClass}
                      aria-label={t("status")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVE_JOB_STATUS_VALUES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t(JOB_STATUS_LABEL_KEYS[status])}
                        </SelectItem>
                      ))}
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
                    className={cn(
                      "h-3.5 w-3.5",
                      loading && "motion-safe:animate-spin",
                    )}
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

          <section className="relative flex flex-1 flex-col gap-3 lg:grid lg:min-h-0 lg:h-full lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)] lg:items-stretch">
            <div
              className="flex shrink-0 items-center rounded-lg bg-muted/70 p-0.5 lg:hidden"
              aria-label={t("mobileTablistLabel")}
              {...mobileTabs.tabListProps}
            >
              <button
                type="button"
                {...mobileTabs.getTabProps("list")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 min-h-[44px]",
                  mobileTab === "list"
                    ? "bg-background text-brand-emerald-text shadow-sm"
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
                {...mobileTabs.getTabProps("detail")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 min-h-[44px]",
                  mobileTab === "detail"
                    ? "bg-background text-brand-emerald-text shadow-sm"
                    : "text-muted-foreground active:bg-background/60",
                )}
              >
                {t("tabDetail")}
              </button>
            </div>

            {/* Results panel */}
            <div
              {...mobileTabs.getPanelProps("list")}
              hidden={undefined}
              data-testid="jobs-results-panel"
              className={cn(
                "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
                "rounded-2xl border border-border/70 bg-background/90 shadow-sm",
                "lg:rounded-2xl lg:bg-background",
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
                <div className="min-w-0">
                  <JobSearchBar
                    q={q}
                    onQueryChange={setQ}
                    onSubmit={triggerSearch}
                    placeholder={t("placeholder")}
                    isDebouncing={q !== "" && q !== debouncedQ}
                  />
                </div>
              </div>
              {/* The status choice IS the results header. The old layout spent
              two rows saying "Results · 14 jobs · 10 loaded" above the tabs —
              three counts for one list. The active segment now carries the
              one count that matters; loading progress lives at the list
              bottom where the loading actually happens. */}
              <div className="flex items-center gap-2 border-b px-4 pb-3 pt-3">
                <SegmentedControl
                  ariaLabel={t("status")}
                  value={statusFilter}
                  onChange={(next) =>
                    startTransition(() => setStatusFilter(next))
                  }
                  segmentClassName="min-w-0 px-2.5"
                  options={ACTIVE_JOB_STATUS_VALUES.map((status) => ({
                    value: status,
                    label: t(JOB_STATUS_LABEL_KEYS[status]),
                    count:
                      status === statusFilter && typeof totalCount === "number"
                        ? totalCount
                        : undefined,
                  }))}
                />

                {/* The batch sweep button lived here. It queued every
                eligible NEW job in one press and refused outright while any
                run was draining — so wanting a single job meant committing
                to a hundred, or waiting on a hundred. Generation is now a
                per-job action in the JD header, and this row is the status
                filter again, nothing else. */}
              </div>
              <div className="relative flex min-h-0 flex-1 flex-col">
                <ScrollArea
                  ref={resultsScrollRef}
                  type="scroll"
                  data-testid="jobs-results-scroll"
                  data-loading={showLoadingOverlay ? "true" : "false"}
                  data-virtual={virtualListEnabled ? "true" : "false"}
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
                  {visibleItems.length > 0 ? (
                    virtualListEnabled ? (
                      <div
                        ref={jobListRef}
                        role="list"
                        tabIndex={effectiveSelectedId === null ? 0 : -1}
                      >
                        <VirtualJobList
                          ref={virtualJobListRef}
                          items={visibleItems}
                          effectiveSelectedId={effectiveSelectedId}
                          onSelect={handleSelectJob}
                          timeZone={timeZone}
                          scrollRootRef={resultsScrollRef}
                        />
                      </div>
                    ) : (
                      <div
                        ref={jobListRef}
                        role="list"
                        tabIndex={effectiveSelectedId === null ? 0 : -1}
                        className="space-y-3 p-3"
                      >
                        {visibleItems.map((it) => (
                          <JobRow
                            key={it.id}
                            job={it}
                            isActive={it.id === effectiveSelectedId}
                            onSelectJob={handleSelectJob}
                            timeZone={timeZone}
                            reducedMotion={reducedMotion}
                          />
                        ))}
                      </div>
                    )
                  ) : showEmpty ? (
                    <div className="flex h-full min-h-[440px] flex-col items-center justify-center px-6 py-12 text-center">
                      <motion.div
                        initial={
                          reducedMotion
                            ? false
                            : { opacity: 0, y: 10, scale: 0.97 }
                        }
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
                          <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-emerald-50 to-white text-brand-emerald-600 shadow-sm ring-1 ring-brand-emerald-100 dark:from-brand-emerald-500/10 dark:to-transparent">
                            {/* An empty board is empty sky: a constellation, not a
                          compass. The lead star breathes; the rest are quiet. */}
                            <svg
                              viewBox="0 0 48 48"
                              fill="none"
                              className="h-7 w-7"
                              aria-hidden
                            >
                              <path
                                d="M10 30 L20 14 L31 24 L40 12"
                                stroke="currentColor"
                                strokeWidth="1"
                                strokeDasharray="2 3"
                                strokeLinecap="round"
                                opacity="0.45"
                              />
                              <path
                                d="M20 14 L26 36"
                                stroke="currentColor"
                                strokeWidth="1"
                                strokeDasharray="2 3"
                                strokeLinecap="round"
                                opacity="0.28"
                              />
                              <circle
                                cx="10"
                                cy="30"
                                r="1.3"
                                fill="currentColor"
                                opacity="0.7"
                              />
                              <circle
                                cx="31"
                                cy="24"
                                r="1.3"
                                fill="currentColor"
                                opacity="0.7"
                              />
                              <circle
                                cx="40"
                                cy="12"
                                r="1.1"
                                fill="currentColor"
                                opacity="0.55"
                              />
                              <circle
                                cx="26"
                                cy="36"
                                r="1.1"
                                fill="currentColor"
                                opacity="0.55"
                              />
                              <circle
                                cx="20"
                                cy="14"
                                r="2.4"
                                fill="currentColor"
                                className="cosmos-star"
                              />
                            </svg>
                          </span>
                        </div>
                        <h3 className="text-base font-semibold tracking-tight text-foreground">
                          {activeFilterCount > 0
                            ? t("emptyHeadlineFiltered")
                            : t("emptyHeadline")}
                        </h3>
                        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
                          {activeFilterCount > 0
                            ? t("emptySubtextFiltered")
                            : t("emptySubtext")}
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
              panelProps={{
                ...mobileTabs.getPanelProps("detail"),
                hidden: undefined,
              }}
              selectedJob={selectedJob}
              selectedDescription={selectedDescription}
              experienceAnalysis={
                selectedDetailData?.experienceAnalysis ?? null
              }
              detailError={detailError}
              detailLoading={detailLoading}
              showLoadingOverlay={showLoadingOverlay}
              tailorSource={selectedTailorSource}
              updatingIds={updatingIds}
              deletingIds={deletingIds}
              mobileTab={mobileTab}
              onUpdateStatus={updateStatus}
              onDelete={requestDelete}
              onTailor={handleTailor}
              onRetryDetail={() => void refetchDetail()}
            />
          </section>
        </div>
      </div>
    </>
  );
}
