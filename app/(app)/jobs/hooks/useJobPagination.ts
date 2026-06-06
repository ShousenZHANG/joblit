import { useEffect, useMemo, useRef } from "react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { JobItem, JobsResponse } from "../types";
import {
  buildInitialJobsInfiniteData,
  getJobsListQueryKey,
  type JobsInfiniteData,
} from "../utils/jobsQueryCache";
import { visibleTotalCount } from "../utils/visibleTotalCount";

const INFINITE_SCROLL_TRIGGER_RATIO = 0.8;
// Below this many loaded rows, pull the next page even if the list still
// overflows — keeps the list replenished as the user deletes.
const REPLENISH_WATERMARK = 8;

export function useJobPagination({
  queryString,
  initialItems,
  initialCursor,
  suppressedDeletedIds,
  scrollRef,
}: {
  queryString: string;
  initialItems: JobItem[];
  initialCursor: string | null;
  suppressedDeletedIds: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const queryClient = useQueryClient();

  // The SSR payload only seeds the very first filter the page mounts with.
  const initialQueryRef = useRef<string | null>(null);
  if (initialQueryRef.current === null) {
    initialQueryRef.current = queryString;
  }

  // One infinite query per filter. `placeholderData: keepPreviousData` keeps
  // the ENTIRE previous filter's pages on screen while the new filter loads —
  // no cursor-array shrink, no per-slot observer remap, so switching filters
  // can no longer truncate the list, flash a skeleton, or surface the wrong
  // filter's rows. Pagination + delete-backfill go through `fetchNextPage`.
  const query = useInfiniteQuery({
    queryKey: getJobsListQueryKey(queryString),
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: string | null;
      signal: AbortSignal;
    }): Promise<JobsResponse> => {
      const sp = new URLSearchParams(queryString);
      if (pageParam) sp.set("cursor", pageParam);
      const res = await fetch(`/api/jobs?${sp.toString()}`, { signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load jobs");
      return {
        items: json.items ?? [],
        nextCursor: json.nextCursor ?? null,
        totalCount: typeof json.totalCount === "number" ? json.totalCount : undefined,
        facets: json.facets ?? undefined,
      };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(queryString),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    initialData: (): JobsInfiniteData | undefined => {
      if (initialItems.length === 0 || initialQueryRef.current !== queryString) {
        return undefined;
      }
      return buildInitialJobsInfiniteData({
        initialItems,
        initialCursor: initialCursor ?? null,
      });
    },
  });

  const queryData = query.data;

  const mergedItems = useMemo(() => {
    const merged: JobItem[] = [];
    const seenIds = new Set<string>();
    for (const page of queryData?.pages ?? []) {
      for (const item of page.items ?? []) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [queryData]);

  const items = useMemo(
    () => mergedItems.filter((item) => !suppressedDeletedIds.has(item.id)),
    [mergedItems, suppressedDeletedIds],
  );

  const firstPage = queryData?.pages[0];
  // Rows hidden by an in-flight (undo-window) delete are filtered out of
  // `items` but still live in the cache, so subtract them from the server total
  // — this keeps the count dropping on delete and returning on undo WITHOUT
  // mutating the cache during the window (which is what lets concurrent pending
  // deletes/undos and background refetches stay consistent). See
  // visibleTotalCount for the derivation.
  const totalCount = visibleTotalCount(firstPage?.totalCount, mergedItems.length, items.length);
  const nextCursor = query.hasNextPage
    ? queryData?.pages[queryData.pages.length - 1]?.nextCursor ?? null
    : null;
  const loading = query.isFetching;
  // First page has truly resolved only once real (non-placeholder) data lands.
  // Gating empty/skeleton on this — not on `!loading` — kills both the "No
  // jobs" flash during a filter switch and the wrong-filter rows that the old
  // per-cursor placeholder could surface.
  const firstPageResolved = query.isSuccess && !query.isPlaceholderData;
  const loadingInitial = !firstPageResolved && items.length === 0;
  // Empty state keys on `mergedItems` (the actual fetched result), NOT `items`
  // (which also strips ids in `suppressedDeletedIds`). Otherwise a list whose
  // rows are mid-delete — still present in cache but suppressed — would read as
  // "No jobs found" even though the query returned rows.
  const showEmpty = firstPageResolved && mergedItems.length === 0;
  const loadingMore = query.isFetchingNextPage;

  const firstQueryError = query.error;

  // Synthesized for JobsClient's import-refresh detector, which checks "are we
  // on the first page only?". pageParams[0] is always null (first page).
  const loadedCursors = queryData?.pageParams ?? [null];

  // Reset to the first page (used after a fetch import lands). Slicing the
  // cached pages down to page 0 lets the subsequent invalidate refetch a
  // single page instead of replaying every loaded page.
  const resetPagination = useMemo(
    () => () => {
      queryClient.setQueryData<JobsInfiniteData>(
        getJobsListQueryKey(queryString),
        (old) => {
          if (!old || old.pages.length <= 1) return old;
          return {
            pages: old.pages.slice(0, 1),
            pageParams: old.pageParams.slice(0, 1),
          };
        },
      );
    },
    [queryClient, queryString],
  );

  const jobLevelOptions = useMemo(() => {
    const fromItems = items
      .map((item) => item.jobLevel)
      .filter((level): level is string => Boolean(level));
    const fromFacets = firstPage?.facets?.jobLevels ?? [];
    return Array.from(new Set([...fromFacets, ...fromItems]));
  }, [items, firstPage]);

  const { fetchNextPage, hasNextPage } = query;

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;

    const tryLoadMore = () => {
      if (loading || !hasNextPage) return;
      const viewportBottom = viewport.scrollTop + viewport.clientHeight;
      const triggerPoint = viewport.scrollHeight * INFINITE_SCROLL_TRIGGER_RATIO;
      const isNearBottom =
        viewportBottom >= triggerPoint || viewport.scrollHeight <= viewport.clientHeight + 1;
      // Low-watermark replenish: the pixel-based underfill check only fires
      // once the list is shorter than the viewport, so deleting from a still-
      // overflowing list would drain it row by row. Top it back up whenever the
      // loaded count drops below the watermark and pages remain. fetchNextPage
      // is internally de-duped by React Query, so this can't double-fetch.
      const belowWatermark = items.length < REPLENISH_WATERMARK;
      if (!isNearBottom && !belowWatermark) return;
      void fetchNextPage();
    };

    const onScroll = () => {
      tryLoadMore();
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    const rafId = window.requestAnimationFrame(tryLoadMore);
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(rafId);
    };
    // `items.length` is a dep so that when a delete (single or batch) shrinks
    // the list, the underfill/watermark check re-runs and backfills the gap.
  }, [loading, hasNextPage, fetchNextPage, scrollRef, items.length]);

  return {
    items,
    totalCount,
    nextCursor,
    loading,
    loadingInitial,
    showEmpty,
    loadingMore,
    pageResponses: queryData?.pages ?? [],
    loadedCursors,
    resetPagination,
    firstQueryError,
    jobLevelOptions,
  };
}
