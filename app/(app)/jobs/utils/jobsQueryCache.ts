import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { JobItem, JobsResponse, JobStatus } from "../types";

const JOBS_QUERY_KEY = ["jobs"] as const;

// One infinite query per filter (queryString). Pages are nested under
// `data.pages`; `data.pageParams[0]` is always `null` (the first page is
// fetched with no cursor). totalCount/facets live on page 0.
export type JobsInfiniteData = InfiniteData<JobsResponse, string | null>;

export function getJobsListQueryKey(queryString: string) {
  return [JOBS_QUERY_KEY[0], queryString] as const;
}

export function getJobDetailsQueryKey(jobId: string | null) {
  return ["job-details", jobId] as const;
}

function readJobsQueryStatusFilter(queryKey: QueryKey): JobStatus | "ALL" {
  const serializedQuery = typeof queryKey[1] === "string" ? queryKey[1] : "";
  const statusParam = new URLSearchParams(serializedQuery).get("status");
  if (statusParam === "NEW" || statusParam === "APPLIED" || statusParam === "REJECTED") {
    return statusParam;
  }
  return "ALL";
}

export function cancelJobsQueries(queryClient: QueryClient) {
  return queryClient.cancelQueries({ queryKey: JOBS_QUERY_KEY });
}

export function invalidateJobsQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
}

export function invalidateActiveJobsQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY, refetchType: "active" });
}

function getJobsQueryEntries(queryClient: QueryClient) {
  return queryClient.getQueryCache().findAll({ queryKey: JOBS_QUERY_KEY });
}

function getJobLevels(items: JobItem[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.jobLevel)
        .filter((level): level is string => Boolean(level)),
    ),
  );
}

function decrementCount(count: number | undefined, by: number) {
  return typeof count === "number" ? Math.max(0, count - by) : count;
}

function isInfiniteJobsData(data: unknown): data is JobsInfiniteData {
  return Boolean(data) && Array.isArray((data as JobsInfiniteData).pages);
}

// Apply a per-page transform across every loaded page. The returned `removed`
// counts are summed and subtracted from page 0's totalCount (the server total
// for the filter), so the displayed count stays correct after optimistic edits.
function mapJobsPages(
  data: JobsInfiniteData,
  transform: (items: JobItem[]) => { items: JobItem[]; removed: number },
): JobsInfiniteData {
  let totalRemoved = 0;
  const pages = data.pages.map((page) => {
    const result = transform(page.items ?? []);
    totalRemoved += result.removed;
    return { ...page, items: result.items };
  });
  if (totalRemoved > 0 && pages.length > 0) {
    pages[0] = {
      ...pages[0],
      totalCount: decrementCount(pages[0].totalCount, totalRemoved),
    };
  }
  return { ...data, pages };
}

export function buildInitialJobsInfiniteData({
  initialItems,
  initialCursor,
}: {
  initialItems: JobItem[];
  initialCursor: string | null;
}): JobsInfiniteData {
  return {
    pages: [
      {
        items: initialItems,
        nextCursor: initialCursor,
        facets: { jobLevels: getJobLevels(initialItems) },
      },
    ],
    pageParams: [null],
  };
}

export type JobsQuerySnapshot = {
  queryKey: QueryKey;
  data: JobsInfiniteData | undefined;
};

// Snapshot every cached jobs query so an optimistic mutation can be rolled
// back to the EXACT prior state (pages, params, counts) on failure/undo —
// strictly more accurate than the old per-item index patches.
function snapshotJobsQueries(queryClient: QueryClient): JobsQuerySnapshot[] {
  return getJobsQueryEntries(queryClient).map((query) => ({
    queryKey: query.queryKey,
    data: queryClient.getQueryData<JobsInfiniteData>(query.queryKey),
  }));
}

export function restoreJobsSnapshots(
  queryClient: QueryClient,
  snapshots: JobsQuerySnapshot[] | undefined,
) {
  for (const snapshot of snapshots ?? []) {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data);
  }
}

export function patchJobStatusInJobsCache(
  queryClient: QueryClient,
  id: string,
  status: JobStatus,
): JobsQuerySnapshot[] {
  const snapshots = snapshotJobsQueries(queryClient);

  for (const query of getJobsQueryEntries(queryClient)) {
    const currentFilter = readJobsQueryStatusFilter(query.queryKey);
    const shouldKeep = currentFilter === "ALL" || currentFilter === status;

    queryClient.setQueryData<JobsInfiniteData>(query.queryKey, (old) => {
      if (!isInfiniteJobsData(old)) return old;
      return mapJobsPages(old, (items) => {
        if (shouldKeep) {
          return {
            items: items.map((it) => (it.id === id ? { ...it, status } : it)),
            removed: 0,
          };
        }
        const next = items.filter((it) => it.id !== id);
        return { items: next, removed: items.length - next.length };
      });
    });
  }

  return snapshots;
}

export function removeJobFromJobsCache(
  queryClient: QueryClient,
  id: string,
): JobsQuerySnapshot[] {
  const snapshots = snapshotJobsQueries(queryClient);

  for (const query of getJobsQueryEntries(queryClient)) {
    queryClient.setQueryData<JobsInfiniteData>(query.queryKey, (old) => {
      if (!isInfiniteJobsData(old)) return old;
      return mapJobsPages(old, (items) => {
        const next = items.filter((it) => it.id !== id);
        return { items: next, removed: items.length - next.length };
      });
    });
  }

  return snapshots;
}

export function removeJobsFromJobsCache(
  queryClient: QueryClient,
  ids: Set<string>,
): JobsQuerySnapshot[] {
  const snapshots = snapshotJobsQueries(queryClient);

  for (const query of getJobsQueryEntries(queryClient)) {
    queryClient.setQueryData<JobsInfiniteData>(query.queryKey, (old) => {
      if (!isInfiniteJobsData(old)) return old;
      return mapJobsPages(old, (items) => {
        const next = items.filter((it) => !ids.has(it.id));
        return { items: next, removed: items.length - next.length };
      });
    });
  }

  return snapshots;
}

export function patchGeneratedJobArtifactInJobsCache({
  queryClient,
  id,
  patch,
}: {
  queryClient: QueryClient;
  id: string;
  patch: Partial<Pick<JobItem, "resumePdfUrl" | "resumePdfName" | "coverPdfUrl">>;
}) {
  for (const query of getJobsQueryEntries(queryClient)) {
    queryClient.setQueryData<JobsInfiniteData>(query.queryKey, (old) => {
      if (!isInfiniteJobsData(old)) return old;
      return mapJobsPages(old, (items) => ({
        items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        removed: 0,
      }));
    });
  }
}
