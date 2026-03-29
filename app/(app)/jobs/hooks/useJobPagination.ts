import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { JobItem, JobsResponse } from "../types";

const INFINITE_SCROLL_TRIGGER_RATIO = 0.8;

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
  const [loadedCursors, setLoadedCursors] = useState<(string | null)[]>([null]);

  const resetPagination = useMemo(
    () => () => {
      setLoadedCursors([null]);
    },
    [],
  );

  const initialQueryRef = useRef<string | null>(null);
  if (initialQueryRef.current === null) {
    initialQueryRef.current = queryString;
  }
  const didHydrateInitialRef = useRef(false);

  useLayoutEffect(() => {
    if (didHydrateInitialRef.current) return;
    const shouldUseInitial =
      initialItems.length > 0 &&
      loadedCursors.length === 1 &&
      loadedCursors[0] === null &&
      initialQueryRef.current === queryString;
    if (!shouldUseInitial) return;

    const initialLevels = Array.from(
      new Set(
        initialItems
          .map((item) => item.jobLevel)
          .filter((level): level is string => Boolean(level)),
      ),
    );

    const key = ["jobs", queryString, null] as const;
    queryClient.setQueryData<JobsResponse>(key, (old) => ({
      ...old,
      items: initialItems,
      nextCursor: initialCursor ?? null,
      facets: {
        ...(old?.facets ?? {}),
        jobLevels: old?.facets?.jobLevels ?? initialLevels,
      },
      totalCount: old?.totalCount,
    }));
    didHydrateInitialRef.current = true;
  }, [initialCursor, initialItems, loadedCursors, queryClient, queryString]);

  const pageQueries = useQueries({
    queries: loadedCursors.map((loadedCursor, pageIndex) => ({
      queryKey: ["jobs", queryString, loadedCursor] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<JobsResponse> => {
        const sp = new URLSearchParams(queryString);
        if (loadedCursor) sp.set("cursor", loadedCursor);
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
      enabled: Boolean(queryString),
      placeholderData: (prev: JobsResponse | undefined) => prev,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      initialData: (): JobsResponse | undefined => {
        const shouldUseInitial =
          pageIndex === 0 &&
          initialItems.length > 0 &&
          loadedCursor === null &&
          loadedCursors.length === 1 &&
          initialQueryRef.current === queryString;
        if (!shouldUseInitial) return undefined;
        const initialLevels = Array.from(
          new Set(
            initialItems
              .map((item) => item.jobLevel)
              .filter((level): level is string => Boolean(level)),
          ),
        );
        return {
          items: initialItems,
          nextCursor: initialCursor ?? null,
          facets: {
            jobLevels: initialLevels,
          },
        };
      },
    })),
  });

  const pageResponses = useMemo(
    () =>
      pageQueries
        .map((query) => query.data)
        .filter((data): data is JobsResponse => Boolean(data)),
    [pageQueries],
  );

  const mergedItems = useMemo(() => {
    const merged: JobItem[] = [];
    const seenIds = new Set<string>();
    for (const page of pageResponses) {
      for (const item of page.items ?? []) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [pageResponses]);

  const items = useMemo(
    () => mergedItems.filter((item) => !suppressedDeletedIds.has(item.id)),
    [mergedItems, suppressedDeletedIds],
  );

  const totalCount = pageResponses[0]?.totalCount;
  const nextCursor = pageResponses.length
    ? pageResponses[pageResponses.length - 1]?.nextCursor ?? null
    : null;
  const loading = pageQueries.some((query) => query.isFetching);
  const loadingInitial = pageQueries.some((query) => query.isLoading) && items.length === 0;

  const firstQueryError = pageQueries.find((query) => query.error)?.error;

  const jobLevelOptions = useMemo(() => {
    const fromItems = items
      .map((item) => item.jobLevel)
      .filter((level): level is string => Boolean(level));
    const fromFacets = pageResponses[0]?.facets?.jobLevels ?? [];
    return Array.from(new Set([...fromFacets, ...fromItems]));
  }, [items, pageResponses]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) return;

    const tryLoadMore = () => {
      if (loading || !nextCursor) return;
      const viewportBottom = viewport.scrollTop + viewport.clientHeight;
      const triggerPoint = viewport.scrollHeight * INFINITE_SCROLL_TRIGGER_RATIO;
      const isNearBottom =
        viewportBottom >= triggerPoint || viewport.scrollHeight <= viewport.clientHeight + 1;
      if (!isNearBottom) return;
      setLoadedCursors((prev) => {
        if (prev.includes(nextCursor)) return prev;
        return [...prev, nextCursor];
      });
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
  }, [loading, nextCursor, scrollRef]);

  return {
    items,
    totalCount,
    nextCursor,
    loading,
    loadingInitial,
    pageResponses,
    loadedCursors,
    resetPagination,
    firstQueryError,
    jobLevelOptions,
  };
}
