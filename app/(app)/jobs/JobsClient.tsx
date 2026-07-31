"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { jobDetailResponseSchema } from "@/lib/shared/schemas/jobsList";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2, CheckSquare, Loader2, MapPin, RefreshCw, SlidersHorizontal, Sparkles, Square, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessibleTabs } from "@/components/ui/useAccessibleTabs";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useFetchStatus, type FetchRunStatus } from "@/app/FetchStatusContext";

import {
  JOB_STATUS_LABEL_KEYS,
  type JobItem,
  type JobStatus,
} from "./types";
import { ACTIVE_JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";
import { SegmentedControl } from "@/components/app-shell/SegmentedControl";
import { getErrorMessage } from "./types";
import { useJobFilters } from "./hooks/useJobFilters";
import { useJobPagination } from "./hooks/useJobPagination";
import { useSuppressedJobRows } from "./hooks/useSuppressedJobRows";
import { useJobMutations } from "./hooks/useJobMutations";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useExternalGenerate } from "./hooks/useExternalGenerate";
import { JobListItem } from "./components/JobListItem";
import { useFitScan } from "./hooks/useFitScan";
import { VirtualJobList, type VirtualJobListHandle } from "./components/VirtualJobList";
import { JobBatchDeleteDialog } from "./components/JobBatchDeleteDialog";
import { JobSearchBar } from "./components/JobSearchBar";
import { ExternalGenerateDialog } from "./components/ExternalGenerateDialog";
import { TailorReviewDialog } from "./components/TailorReviewDialog";
import { JobDetailPanel } from "./components/JobDetailPanel";
import { cn } from "@/lib/utils";
import { AU_LOCATION_OPTIONS, CN_LOCATION_OPTIONS, getUserTimeZone } from "./utils/constants";
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
    urlState,
    replaceUrlStateShallow,
  } = useJobFilters();
  const urlSelectedId = urlState.selectedId;
  const urlView = urlState.view;

  const [selectedId, setSelectedId] = useState<string | null>(
    () => urlSelectedId ?? initialItems[0]?.id ?? null,
  );
  const [selectionExplicitlyCleared, setSelectionExplicitlyCleared] = useState(false);
  const [mobileTab, setMobileTab] = useState<"list" | "detail">(
    () => urlView,
  );
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
      setSelectionExplicitlyCleared(false);
      setSelectedId(id);
      persistWorkspaceUrl({ selectedId: id });
    },
    [persistWorkspaceUrl],
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
    setSelectionExplicitlyCleared(false);
    setSelectedId(urlSelectedId);
    setMobileTab(urlView);
  }, [urlSelectedId, urlView]);

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
  // Sorting by score and hiding low-fit rows are not exposed yet, so every
  // loaded row is shown. Both return with the fit tools they belong to.
  const visibleItems = items;

  const {
    updateStatus, requestDelete, batchDeleteMutation,
    updatingIds, deletingIds,
    error: mutationError, setError,
  } = useJobMutations({
    items: visibleItems,
    selectedId,
    setSelectedId: setSelectedIdFromMutation,
    hideJobs,
    revealJobs,
  });

  const ext = useExternalGenerate(setError);
  const fitScan = useFitScan({ onJobScored: refetch });
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

  // Full-database sweep: preview the count, confirm, move NEW -> ignored
  // (REJECTED, reversible) server-side, then offer one-click undo.
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
    () => visibleItems.map((item) => item.id).join("|"),
    [visibleItems],
  );
  const [prevItemsIdKey, setPrevItemsIdKey] = useState(itemsIdKey);
  if (itemsIdKey !== prevItemsIdKey) {
    setPrevItemsIdKey(itemsIdKey);
    if (
      batchSelectMode &&
      batchSelectedIds.size > 0 &&
      !batchDeleteMutation.isPending
    ) {
      const currentIds = new Set(visibleItems.map((item) => item.id));
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
  const allVisibleBatchSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => batchSelectedIds.has(item.id));

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
    const inProgress = current.status === "RUNNING" || current.status === "QUEUED";
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

  function toggleBatchSelect(id: string) {
    setBatchSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = visibleItems.map((item) => item.id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => batchSelectedIds.has(id));
    if (allVisibleSelected) {
      setBatchSelectedIds(new Set());
    } else {
      setBatchSelectedIds(new Set(visibleIds));
    }
  }

  function exitBatchMode() {
    setBatchSelectMode(false);
    setBatchSelectedIds(new Set());
  }

  const [batchGeneratePending, setBatchGeneratePending] = useState(false);
  async function confirmBatchGenerate() {
    const ids = [...batchSelectedIds];
    if (ids.length === 0 || batchGeneratePending) return;
    setBatchGeneratePending(true);
    try {
      await fetchJson("/api/application-batches", {
        method: "POST",
        body: JSON.stringify({ scope: "NEW", selectedJobIds: ids }),
      });
      toast({
        title: t("batchQueuedTitle"),
        description: t("batchQueuedDesc", { count: ids.length }),
        duration: 6000,
        className:
          "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
      });
      exitBatchMode();
    } catch (err) {
      // The one expected refusal: the protocol allows a single active batch.
      // Selection survives so the retry is one click, not a re-pick.
      const alreadyRunning =
        err instanceof ApiError && err.code === "ACTIVE_BATCH_EXISTS";
      toast({
        title: alreadyRunning
          ? t("batchAlreadyRunning")
          : getErrorMessage(err, t("errorLoadJobs")),
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setBatchGeneratePending(false);
    }
  }

  function confirmBatchDelete() {
    const ids = [...batchSelectedIds].filter((id) => !deletingIds.has(id));
    if (ids.length > 0) {
      batchDeleteMutation.mutate(ids, {
        onSuccess: (result) => {
          if (result.failedIds.length > 0) {
            setBatchSelectMode(true);
            setBatchSelectedIds(new Set(result.failedIds));
            return;
          }
          exitBatchMode();
        },
        onError: () => {
          setBatchSelectMode(true);
          setBatchSelectedIds(new Set(ids));
        },
      });
    }
    setBatchDeleteConfirmOpen(false);
  }

  const effectiveSelectedId = useMemo(() => {
    if (selectionExplicitlyCleared) return null;
    if (!visibleItems.length) return null;
    if (
      selectedId &&
      visibleItems.some((item) => item.id === selectedId)
    ) {
      return selectedId;
    }
    return visibleItems[0]?.id ?? null;
  }, [selectedId, selectionExplicitlyCleared, visibleItems]);

  const handleSelectJob = useCallback((id: string | null) => {
    const showDetail =
      id !== null && typeof window !== "undefined" && window.innerWidth < 1024;
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
  }, [markTaskComplete, persistWorkspaceUrl]);

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
  const selectedTailorSource = selectedJob ? ext.tailorSourceByJob[selectedJob.id] : undefined;
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
  const fitDetailRefetchKeyRef = useRef<string | null>(null);
  const selectedDescription = selectedJob ? detailData?.description ?? "" : "";
  const selectedJobId = selectedJob?.id;
  const selectedJobVersion = selectedJob?.updatedAt;
  const selectedJobEligibility = selectedJob?.fitEligibility;
  // The list and detail have different cache lifetimes. Compare row versions
  // so any re-score/status update refreshes the detail instead of combining a
  // new score with a stale GATE matrix for up to five minutes.
  useEffect(() => {
    const versionChanged =
      Boolean(detailData?.updatedAt) &&
      detailData?.updatedAt !== selectedJobVersion;
    const missingCompletedMatrix =
      Boolean(selectedJobEligibility) && !detailData?.fitMatrix;
    if (
      selectedJobId &&
      (versionChanged || missingCompletedMatrix) &&
      !detailIsFetching
    ) {
      const key = `${selectedJobId}:${selectedJobVersion}`;
      if (fitDetailRefetchKeyRef.current === key) return;
      fitDetailRefetchKeyRef.current = key;
      void refetchDetail();
    }
  }, [
    detailData?.fitMatrix,
    detailData?.updatedAt,
    detailIsFetching,
    refetchDetail,
    selectedJobEligibility,
    selectedJobId,
    selectedJobVersion,
  ]);
  const detailError = detailQueryError
    ? getErrorMessage(detailQueryError, t("errorLoadDetails"))
    : null;
  const detailLoading = detailIsFetching && !detailData;


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

      <div
        data-testid="jobs-shell"
        className="relative flex flex-1 flex-col gap-2 pb-0 text-foreground lg:min-h-0 lg:h-full lg:overflow-hidden"
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
                  disabled={batchDeleteMutation.isPending}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground/90 transition-colors hover:bg-brand-emerald-100 disabled:cursor-wait disabled:opacity-60"
                  aria-label={allVisibleBatchSelected ? t("deselectAll") : t("selectAll")}
                >
                  {allVisibleBatchSelected ? (
                    <CheckSquare className="h-4 w-4 text-brand-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                  {batchSelectedIds.size > 0 ? (
                    <span className="font-semibold text-brand-emerald-text">{t("selectedCount", { count: batchSelectedIds.size })}</span>
                  ) : (
                    <span>{t("selectAll")}</span>
                  )}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={batchSelectedIds.size === 0 || batchGeneratePending || batchDeleteMutation.isPending}
                  onClick={confirmBatchGenerate}
                  aria-busy={batchGeneratePending}
                  className="flex items-center gap-1 rounded-lg bg-brand-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-brand-emerald-700 active:translate-y-px disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                >
                  {batchGeneratePending ? (
                    <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {batchGeneratePending ? t("generatingSelected") : t("generateSelected")}
                </button>
                <button
                  type="button"
                  disabled={batchSelectedIds.size === 0 || batchDeleteMutation.isPending}
                  onClick={() => setBatchDeleteConfirmOpen(true)}
                  aria-busy={batchDeleteMutation.isPending}
                  className="flex items-center gap-1 rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground shadow-sm transition-all duration-150 hover:bg-destructive/90 active:translate-y-px disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                >
                  {batchDeleteMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {batchDeleteMutation.isPending ? t("deletingSelected") : tc("delete")}
                </button>
                <button
                  type="button"
                  disabled={batchDeleteMutation.isPending}
                  onClick={exitBatchMode}
                  className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
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
              {/* Toolbar. Three control types sat in one flat scrolling row of
                  identical pills, so an exclusive filter, a view toggle and a
                  bulk write were indistinguishable. Each now gets its own
                  affordance: a connected track for the exclusive status
                  choice, tinted toggles for view state, and plain icon
                  buttons for the actions that actually do something. */}
              <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-3">
                <SegmentedControl
                  ariaLabel={t("status")}
                  value={statusFilter}
                  onChange={(next) =>
                    startTransition(() => setStatusFilter(next))
                  }
                  options={ACTIVE_JOB_STATUS_VALUES.map((status) => ({
                    value: status,
                    label: t(JOB_STATUS_LABEL_KEYS[status]),
                  }))}
                />

                {/* One action, sized for the narrow results panel. Sorting,
                    hiding and bulk-ignoring low fit are deliberately not
                    rendered yet: four controls wrapped onto their own lines
                    here and read as decoration rather than tools. */}
                {fitScan.state.status !== "scanning" ? (
                  <button
                    type="button"
                    onClick={() => void fitScan.start()}
                    title={t("fitScan.button")}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[12px] font-semibold text-foreground/75 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    {t("fitScan.scoreShort")}
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {fitScan.state.status === "scanning" ? (
            <div className="flex items-center justify-between gap-3 border-b bg-brand-emerald-50/60 px-4 py-2.5 dark:bg-emerald-500/10" role="status" aria-live="polite">
              <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <Loader2 className="h-4 w-4 shrink-0 text-brand-emerald-600 motion-safe:animate-spin" aria-hidden />
                <span className="truncate">
                  {fitScan.state.waiting
                    ? t("fitScan.bannerWaitingRunner", {
                        remaining: fitScan.state.remaining,
                      })
                    : t("fitScan.bannerScanning", {
                        scored: fitScan.state.scored + fitScan.state.prescreened,
                        remaining: fitScan.state.remaining,
                      })}
                </span>
              </span>
              {fitScan.state.waiting ? (
                <Link
                  href="/agent"
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-emerald-text underline-offset-2 transition-colors hover:underline"
                >
                  {t("fitScan.setUpRunner")}
                </Link>
              ) : null}
              <button
                type="button"
                onClick={fitScan.stop}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("fitScan.stop")}
              </button>
            </div>
          ) : null}
          {fitScan.state.status === "done" || fitScan.state.status === "failed" ? (
            <div
              className={`flex items-center justify-between gap-3 border-b px-4 py-2.5 ${
                fitScan.state.status === "done"
                  ? "bg-brand-emerald-50/60 dark:bg-emerald-500/10"
                  : "bg-destructive/5"
              }`}
              role="status"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {fitScan.state.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-emerald-600" aria-hidden />
                ) : null}
                <span className={`truncate ${fitScan.state.status === "failed" ? "text-destructive" : "text-foreground"}`}>
                  {fitScan.state.status === "done"
                    ? t("fitScan.bannerDone", {
                        scored: fitScan.state.scored,
                        prescreened: fitScan.state.prescreened,
                      })
                    : (fitScan.state.error ?? t("fitScan.failed"))}
                </span>
              </span>
              <button
                type="button"
                onClick={fitScan.reset}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("fitScan.dismiss")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
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
                    batchMode={batchSelectMode}
                    batchSelectedIds={batchSelectedIds}
                    onBatchToggle={toggleBatchSelect}
                  />
                </div>
              ) : (
                <div
                  ref={jobListRef}
                  role="list"
                  tabIndex={effectiveSelectedId === null ? 0 : -1}
                  className="space-y-3 p-3"
                >
                  {visibleItems.map((it) => {
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
                    <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-emerald-50 to-white text-brand-emerald-600 shadow-sm ring-1 ring-brand-emerald-100 dark:from-brand-emerald-500/10 dark:to-transparent">
                      {/* An empty board is empty sky: a constellation, not a
                          compass. The lead star breathes; the rest are quiet. */}
                      <svg viewBox="0 0 48 48" fill="none" className="h-7 w-7" aria-hidden>
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
                        <circle cx="10" cy="30" r="1.3" fill="currentColor" opacity="0.7" />
                        <circle cx="31" cy="24" r="1.3" fill="currentColor" opacity="0.7" />
                        <circle cx="40" cy="12" r="1.1" fill="currentColor" opacity="0.55" />
                        <circle cx="26" cy="36" r="1.1" fill="currentColor" opacity="0.55" />
                        <circle cx="20" cy="14" r="2.4" fill="currentColor" className="cosmos-star" />
                      </svg>
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
          panelProps={{
            ...mobileTabs.getPanelProps("detail"),
            hidden: undefined,
          }}
          selectedJob={selectedJob}
          selectedDescription={selectedDescription}
          selectedFitMatrix={detailData?.fitMatrix ?? null}
          detailError={detailError}
          detailLoading={detailLoading}
          showLoadingOverlay={showLoadingOverlay}
          tailorSource={selectedTailorSource}
          updatingIds={updatingIds}
          deletingIds={deletingIds}
          highlightGenerate={highlightGenerate}
          guideHighlightClass={guideHighlightClass}
          externalPromptLoading={ext.externalGenerating}
          mobileTab={mobileTab}
          onUpdateStatus={updateStatus}
          onDelete={requestDelete}
          onGenerateResume={(job) => ext.openExternalGenerateDialog(job, "resume")}
          onGenerateCover={(job) => ext.openExternalGenerateDialog(job, "cover")}
          onRetryDetail={() => void refetchDetail()}
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
