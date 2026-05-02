import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { JobItem, JobsQueryRollbackPatch, JobsResponse, JobStatus } from "../types";

export const JOBS_QUERY_KEY = ["jobs"] as const;

export function getJobsPageQueryKey(queryString: string, cursor: string | null) {
  return [JOBS_QUERY_KEY[0], queryString, cursor] as const;
}

export function getJobDetailsQueryKey(jobId: string | null) {
  return ["job-details", jobId] as const;
}

export function readJobsQueryStatusFilter(queryKey: QueryKey): JobStatus | "ALL" {
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

export function hydrateInitialJobsPage({
  queryClient,
  queryString,
  initialItems,
  initialCursor,
}: {
  queryClient: QueryClient;
  queryString: string;
  initialItems: JobItem[];
  initialCursor: string | null;
}) {
  const initialLevels = getJobLevels(initialItems);
  const key = getJobsPageQueryKey(queryString, null);
  queryClient.setQueryData<JobsResponse>(key, (old) => ({
    ...old,
    items: initialItems,
    nextCursor: initialCursor,
    facets: {
      ...(old?.facets ?? {}),
      jobLevels: old?.facets?.jobLevels ?? initialLevels,
    },
    totalCount: old?.totalCount,
  }));
}

export function buildInitialJobsPageData({
  initialItems,
  initialCursor,
}: {
  initialItems: JobItem[];
  initialCursor: string | null;
}): JobsResponse {
  return {
    items: initialItems,
    nextCursor: initialCursor,
    facets: {
      jobLevels: getJobLevels(initialItems),
    },
  };
}

export function restoreJobsPatch(old: JobsResponse | undefined, patch: JobsQueryRollbackPatch) {
  if (!old || !Array.isArray(old.items)) return old;
  const nextItems = [...old.items];
  const currentIndex = nextItems.findIndex((it) => it.id === patch.previousItem.id);
  if (currentIndex >= 0) {
    nextItems[currentIndex] = patch.previousItem;
  } else {
    const insertAt = Math.max(0, Math.min(patch.previousIndex, nextItems.length));
    nextItems.splice(insertAt, 0, patch.previousItem);
  }
  return {
    ...old,
    items: nextItems,
    totalCount:
      typeof patch.previousTotalCount === "number" ? patch.previousTotalCount : old.totalCount,
  };
}

export function restoreJobsPatches(
  queryClient: QueryClient,
  patches: JobsQueryRollbackPatch[] | undefined,
) {
  for (const patch of patches ?? []) {
    queryClient.setQueryData<JobsResponse>(patch.queryKey, (old) => restoreJobsPatch(old, patch));
  }
}

export function patchJobStatusInJobsCache(
  queryClient: QueryClient,
  id: string,
  status: JobStatus,
) {
  const rollbackByQueryHash = new Map<string, JobsQueryRollbackPatch>();

  for (const query of getJobsQueryEntries(queryClient)) {
    const key = query.queryKey;
    const queryHash = query.queryHash;
    const currentFilter = readJobsQueryStatusFilter(key);
    const shouldKeep = currentFilter === "ALL" || currentFilter === status;

    queryClient.setQueryData<JobsResponse>(key, (old) => {
      if (!old || !Array.isArray(old.items)) return old;

      const previousIndex = old.items.findIndex((it) => it.id === id);
      if (previousIndex === -1) return old;

      if (!rollbackByQueryHash.has(queryHash)) {
        rollbackByQueryHash.set(queryHash, {
          queryHash,
          queryKey: key,
          previousItem: old.items[previousIndex],
          previousIndex,
          previousTotalCount:
            typeof old.totalCount === "number" ? old.totalCount : undefined,
        });
      }

      const didRemove = !shouldKeep;
      return {
        ...old,
        items: shouldKeep
          ? old.items.map((it) => (it.id === id ? { ...it, status } : it))
          : old.items.filter((it) => it.id !== id),
        totalCount: didRemove ? decrementCount(old.totalCount, 1) : old.totalCount,
      };
    });
  }

  return Array.from(rollbackByQueryHash.values());
}

export function removeJobFromJobsCache(queryClient: QueryClient, id: string) {
  const rollbackByQueryHash = new Map<string, JobsQueryRollbackPatch>();

  for (const query of getJobsQueryEntries(queryClient)) {
    const key = query.queryKey;
    const queryHash = query.queryHash;

    queryClient.setQueryData<JobsResponse>(key, (old) => {
      if (!old || !Array.isArray(old.items)) return old;

      const previousIndex = old.items.findIndex((it) => it.id === id);
      if (previousIndex === -1) return old;

      if (!rollbackByQueryHash.has(queryHash)) {
        rollbackByQueryHash.set(queryHash, {
          queryHash,
          queryKey: key,
          previousItem: old.items[previousIndex],
          previousIndex,
          previousTotalCount:
            typeof old.totalCount === "number" ? old.totalCount : undefined,
        });
      }

      return {
        ...old,
        items: old.items.filter((it) => it.id !== id),
        totalCount: decrementCount(old.totalCount, 1),
      };
    });
  }

  return Array.from(rollbackByQueryHash.values());
}

export type JobsQuerySnapshot = {
  queryKey: QueryKey;
  data: JobsResponse | undefined;
};

export function removeJobsFromJobsCache(queryClient: QueryClient, ids: Set<string>) {
  const rollbackSnapshots: JobsQuerySnapshot[] = [];

  for (const query of getJobsQueryEntries(queryClient)) {
    const key = query.queryKey;
    const currentData = queryClient.getQueryData<JobsResponse>(key);
    rollbackSnapshots.push({ queryKey: key, data: currentData });

    queryClient.setQueryData<JobsResponse>(key, (old) => {
      if (!old || !Array.isArray(old.items)) return old;
      const removedCount = old.items.filter((it) => ids.has(it.id)).length;
      return {
        ...old,
        items: old.items.filter((it) => !ids.has(it.id)),
        totalCount: decrementCount(old.totalCount, removedCount),
      };
    });
  }

  return rollbackSnapshots;
}

export function restoreJobsSnapshots(
  queryClient: QueryClient,
  snapshots: JobsQuerySnapshot[] | undefined,
) {
  for (const snapshot of snapshots ?? []) {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data);
  }
}

export function patchGeneratedJobArtifactInJobsCache({
  queryClient,
  id,
  patch,
}: {
  queryClient: QueryClient;
  id: string;
  patch: Pick<JobItem, "resumePdfUrl" | "resumePdfName">;
}) {
  for (const [key] of queryClient.getQueriesData<JobsResponse>({ queryKey: JOBS_QUERY_KEY })) {
    queryClient.setQueryData<JobsResponse>(key, (old) => {
      if (!old || !Array.isArray(old.items)) return old;
      return {
        ...old,
        items: old.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      };
    });
  }
}
