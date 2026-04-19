"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import "highlight.js/styles/github.css";
import { CheckSquare, MapPin, Plus, RefreshCw, Search, SlidersHorizontal, Square, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterPill } from "@/components/app-shell/FilterPill";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useFetchStatus, type FetchRunStatus } from "@/app/FetchStatusContext";

import type { JobItem, JobStatus } from "./types";
import { getErrorMessage } from "./types";
import { useJobFilters } from "./hooks/useJobFilters";
import { useJobPagination } from "./hooks/useJobPagination";
import { useJobMutations } from "./hooks/useJobMutations";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useExternalGenerate } from "./hooks/useExternalGenerate";
import { JobListItem } from "./components/JobListItem";
import { VirtualJobList } from "./components/VirtualJobList";
import { JobDeleteDialog } from "./components/JobDeleteDialog";
import { JobAddDialog } from "./components/JobAddDialog";
import { JobSearchBar } from "./components/JobSearchBar";
import { ExternalGenerateDialog } from "./components/ExternalGenerateDialog";
import { PdfPreviewDialog } from "./components/PdfPreviewDialog";
import { JobDetailPanel } from "./components/JobDetailPanel";
import { cn } from "@/lib/utils";
import { AU_LOCATION_OPTIONS, CN_LOCATION_OPTIONS, getUserTimeZone } from "./utils/constants";

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
  const [suppressedDeletedIds, setSuppressedDeletedIds] = useState<Set<string>>(new Set());
  const [rescoring, setRescoring] = useState(false);

  const handleRescoreAll = useCallback(async () => {
    if (rescoring) return;
    setRescoring(true);
    try {
      const res = await fetch("/api/jobs/rescore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        scored?: number;
        skippedReason?: "NO_PROFILE" | "NO_JOBS";
      };
      if (!res.ok) {
        toast({
          title: t("rescoreFailed"),
          variant: "destructive",
          duration: 2400,
        });
        return;
      }
      if (json.skippedReason === "NO_PROFILE") {
        toast({
          title: t("rescoreNoProfile"),
          description: t("rescoreNoProfileDesc"),
          variant: "destructive",
          duration: 3200,
        });
        return;
      }
      toast({
        title: t("rescoreDone", { count: json.scored ?? 0 }),
        duration: 1800,
      });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch {
      toast({ title: t("rescoreFailed"), variant: "destructive", duration: 2400 });
    } finally {
      setRescoring(false);
    }
  }, [rescoring, queryClient, toast, t]);

  const {
    items, totalCount, nextCursor, loading, loadingInitial, loadingMore,
    loadedCursors, resetPagination, firstQueryError, jobLevelOptions,
  } = useJobPagination({
    queryString,
    initialItems,
    initialCursor: initialCursor ?? null,
    suppressedDeletedIds,
    scrollRef: resultsScrollRef,
  });

  const {
    updateStatus, deleteMutation, batchDeleteMutation,
    updatingIds, deletingIds,
    error: mutationError, setError,
  } = useJobMutations({
    items,
    selectedId,
    setSelectedId,
    setSuppressedDeletedIds,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{
    url: string;
    filename: string;
    label: string;
  } | null>(null);

  const ext = useExternalGenerate(setError);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; title: string } | null>(null);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);

  const lastSeenImportRef = useRef<{
    runId: string | null;
    status: FetchRunStatus | null;
    importedCount: number;
  } | null>(null);
  const lastImportRefreshAtRef = useRef<number>(0);

  // Reset batch mode on filter change
  const prevQueryStringForBatchRef = useRef(queryString);
  useEffect(() => {
    if (prevQueryStringForBatchRef.current !== queryString) {
      prevQueryStringForBatchRef.current = queryString;
      if (batchSelectMode) {
        setBatchSelectMode(false);
        setBatchSelectedIds(new Set());
      }
    }
  }, [queryString, batchSelectMode]);

  // Prune batch selections when items change
  useEffect(() => {
    if (!batchSelectMode || batchSelectedIds.size === 0) return;
    const currentIds = new Set(items.map((it) => it.id));
    const pruned = new Set([...batchSelectedIds].filter((id) => currentIds.has(id)));
    if (pruned.size !== batchSelectedIds.size) {
      setBatchSelectedIds(pruned);
    }
  }, [items, batchSelectMode, batchSelectedIds]);

  // Status counts derived from loaded items. Not a perfect total (API
  // doesn't return status facets), but gives the filter-pill row a
  // useful number for the portion of results the user has scrolled.
  const statusCounts = useMemo(() => {
    const counts = { NEW: 0, APPLIED: 0, REJECTED: 0 } as Record<
      JobStatus,
      number
    >;
    for (const job of items) {
      if (job.status in counts) counts[job.status] += 1;
    }
    return counts;
  }, [items]);

  // Lock scroll on the app shell.
  // Re-apply after any modal closes — Radix AlertDialog temporarily sets
  // `overflow: hidden` on <body> while open, which can desync the scroll
  // state of .app-shell when the dialog unmounts.
  const anyDialogOpen = deleteConfirmOpen || batchDeleteConfirmOpen || addJobOpen || previewOpen || ext.externalDialogOpen;
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

  const showLoadingOverlay = (loading && !loadingMore) || isPending;
  const listOpacityClass = showLoadingOverlay ? "opacity-70" : "opacity-100";
  const queryError = firstQueryError
    ? getErrorMessage(firstQueryError, "Failed to load jobs")
    : null;
  const activeError = mutationError ?? queryError;

  const activeFilterCount = [
    locationFilter !== "ALL",
    jobLevelFilter !== "ALL",
    statusFilter !== "ALL",
  ].filter(Boolean).length;

  function triggerSearch() {
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
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
    queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });

    if (justBecameTerminal) {
      toast({
        title: "Jobs imported",
        description: `Imported ${delta} new job${delta === 1 ? "" : "s"}. Refreshing list.`,
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

  function scheduleDelete(job: JobItem) {
    if (deletingIds.has(job.id)) return;
    setDeleteCandidate({ id: job.id, title: job.title });
    setDeleteConfirmOpen(true);
  }

  function confirmDeleteCandidate() {
    if (!deleteCandidate) return;
    deleteMutation.mutate(deleteCandidate.id);
    setDeleteConfirmOpen(false);
    setDeleteCandidate(null);
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

  const detailsScrollRef = useRef<HTMLDivElement | null>(null);
  const detailQuery = useQuery({
    queryKey: ["job-details", effectiveSelectedId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${effectiveSelectedId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load details");
      return json as { id: string; description: string | null };
    },
    enabled: Boolean(effectiveSelectedId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const selectedDescription = selectedJob ? detailQuery.data?.description ?? "" : "";
  const detailError = detailQuery.error
    ? getErrorMessage(detailQuery.error, "Failed to load details")
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
        generateComplete={ext.generateComplete}
        successPdf={ext.successPdf}
        successTimerRef={ext.successTimerRef}
        parsedExternalOutput={ext.parsedExternalOutput}
        selectedJob={selectedJob}
        onCopySmartPrompt={ext.copySmartPrompt}
        onDownloadSkillPack={ext.downloadSkillPack}
        onGenerate={ext.generateFromImportedJson}
        onGenerateOther={() => {
          const other = ext.externalTarget === "resume" ? "cover" : "resume";
          if (selectedJob) ext.openExternalGenerateDialog(selectedJob, other);
        }}
      />

      <JobAddDialog open={addJobOpen} onOpenChange={setAddJobOpen} />

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
          {totalCount !== undefined ? `${totalCount} jobs found` : "Loading jobs"}
        </div>
        {/* Mobile-only toolbar. Desktop search/filter row was moved
            into the results (list) column header to match the
            reference layout and reclaim vertical space for the detail
            pane. See the desktop-only block further down. */}
        <div
        role="search"
        aria-label="Job search"
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
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
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
            <Button
              onClick={triggerSearch}
              disabled={loading}
              size="sm"
              className="h-9 shrink-0 rounded-lg bg-brand-emerald-500 px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-emerald-600 active:scale-[0.97]"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          </div>

          {mobileFiltersOpen && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/40 p-2.5">
              <Select
                value={locationFilter}
                onValueChange={(v) => { startTransition(() => { setLocationFilter(v); }); }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <MapPin className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
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
                <SelectTrigger className="h-8 text-xs">
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
                onValueChange={(v) => { startTransition(() => { setStatusFilter(v as JobStatus | "ALL"); }); }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={tc("all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("all")}</SelectItem>
                  <SelectItem value="NEW">{t("statusNew")}</SelectItem>
                  <SelectItem value="APPLIED">{t("statusApplied")}</SelectItem>
                  <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
                </SelectContent>
              </Select>
              {market === "AU" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddJobOpen(true)}
                  className="col-span-2 h-8 gap-1.5 rounded-lg border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:border-brand-emerald-300 hover:bg-brand-emerald-50/60 hover:text-brand-emerald-700"
                >
                  <Plus className="h-3 w-3" />
                  Add Job
                </Button>
              )}
            </div>
          )}
        </div>

      </div>

      {activeError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {activeError}
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
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150",
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
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150",
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
            "h-[calc(100dvh-240px)] lg:h-auto lg:min-h-0 lg:flex-1",
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
                <Button
                  onClick={triggerSearch}
                  disabled={loading}
                  className="h-9 shrink-0 rounded-xl bg-gradient-to-r from-brand-emerald-500 to-brand-emerald-600 px-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:from-brand-emerald-600 hover:to-brand-emerald-700 hover:shadow-md hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
                  aria-label={tc("search")}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleRescoreAll}
                  disabled={rescoring}
                  title={t("rescoreAll")}
                  aria-label={t("rescoreAll")}
                  className="h-9 w-9 shrink-0 rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${rescoring ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <MapPin
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Select
                    value={locationFilter}
                    onValueChange={(v) => {
                      startTransition(() => {
                        setLocationFilter(v);
                      });
                    }}
                  >
                    <SelectTrigger
                      className="h-8 pl-8 text-xs"
                      aria-label={t("location")}
                    >
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
                </div>
                <Select
                  value={jobLevelFilter}
                  onValueChange={(v) => {
                    startTransition(() => {
                      setJobLevelFilter(v);
                    });
                  }}
                >
                  <SelectTrigger
                    className="h-8 flex-1 min-w-0 text-xs"
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
                {market === "AU" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddJobOpen(true)}
                    className="h-8 shrink-0 gap-1 rounded-lg border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:border-brand-emerald-300 hover:bg-brand-emerald-50/60 hover:text-brand-emerald-700"
                    aria-label="Add job"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                )}
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
                  aria-label={batchSelectedIds.size === items.length ? "Deselect all" : "Select all"}
                >
                  {batchSelectedIds.size === items.length ? (
                    <CheckSquare className="h-4 w-4 text-brand-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                  {batchSelectedIds.size > 0 ? (
                    <span className="font-semibold text-brand-emerald-700">{batchSelectedIds.size} selected</span>
                  ) : (
                    <span>Select all</span>
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
                  Delete
                </button>
                <button
                  type="button"
                  onClick={exitBatchMode}
                  className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Exit selection mode"
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
                      · {totalCount} {totalCount === 1 ? "job" : "jobs"}
                    </span>
                  ) : null}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {items.length} loaded
                  </span>
                  <button
                    type="button"
                    onClick={() => setBatchSelectMode(true)}
                    className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Enter selection mode"
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
                  active={statusFilter === "ALL"}
                  onClick={() =>
                    startTransition(() => setStatusFilter("ALL"))
                  }
                >
                  {tc("all")}
                </FilterPill>
                <FilterPill
                  active={statusFilter === "NEW"}
                  count={statusCounts.NEW}
                  onClick={() =>
                    startTransition(() => setStatusFilter("NEW"))
                  }
                >
                  {t("statusNew")}
                </FilterPill>
                <FilterPill
                  active={statusFilter === "APPLIED"}
                  count={statusCounts.APPLIED}
                  onClick={() =>
                    startTransition(() => setStatusFilter("APPLIED"))
                  }
                >
                  {t("statusApplied")}
                </FilterPill>
                <FilterPill
                  active={statusFilter === "REJECTED"}
                  count={statusCounts.REJECTED}
                  onClick={() =>
                    startTransition(() => setStatusFilter("REJECTED"))
                  }
                >
                  {t("statusRejected")}
                </FilterPill>
                <FilterPill
                  active={locationFilter === "REMOTE"}
                  onClick={() =>
                    startTransition(() =>
                      setLocationFilter(
                        locationFilter === "REMOTE" ? "ALL" : "REMOTE",
                      ),
                    )
                  }
                >
                  {t("statusRemote")}
                </FilterPill>
              </div>
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <ScrollArea
            ref={resultsScrollRef}
            type="always"
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
                  {items.map((it) => (
                    <JobListItem
                      key={it.id}
                      job={it}
                      isActive={it.id === effectiveSelectedId}
                      onSelect={() => handleSelectJob(it.id)}
                      timeZone={timeZone}
                      batchMode={batchSelectMode}
                      batchSelected={batchSelectedIds.has(it.id)}
                      onBatchToggle={toggleBatchSelect}
                    />
                  ))}
                </div>
              )
            ) : !loading ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("noJobs")}
              </div>
            ) : null}
          </ScrollArea>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {loadingMore ? (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-brand-emerald-500 border-t-transparent" />
                <span>Loading more jobs…</span>
              </div>
            ) : nextCursor ? (
              "Scroll down to load more"
            ) : (
              "End of results"
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
          onDelete={scheduleDelete}
          onGenerateResume={(job) => ext.openExternalGenerateDialog(job, "resume")}
          onGenerateCover={(job) => ext.openExternalGenerateDialog(job, "cover")}
        />
        </section>
      </div>
      </div>
      <JobDeleteDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setDeleteCandidate(null);
        }}
        candidate={deleteCandidate}
        onConfirm={confirmDeleteCandidate}
      />
      <AlertDialog
        open={batchDeleteConfirmOpen}
        onOpenChange={setBatchDeleteConfirmOpen}
      >
        <AlertDialogContent className="max-w-md rounded-2xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {batchSelectedIds.size} {batchSelectedIds.size === 1 ? "job" : "jobs"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected jobs will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBatchDelete}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {batchSelectedIds.size} {batchSelectedIds.size === 1 ? "job" : "jobs"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
