import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import type { JobItem, JobsResponse, JobStatus, JobsQueryRollbackPatch } from "../types";
import { getErrorMessage } from "../types";

function getStatusFilterFromJobsQueryKey(queryKey: readonly unknown[]): JobStatus | "ALL" {
  const serializedQuery = typeof queryKey[1] === "string" ? queryKey[1] : "";
  const statusParam = new URLSearchParams(serializedQuery).get("status");
  if (statusParam === "NEW" || statusParam === "APPLIED" || statusParam === "REJECTED") {
    return statusParam;
  }
  return "ALL";
}

function restorePatchedJob(old: JobsResponse | undefined, patch: JobsQueryRollbackPatch) {
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

export function useJobMutations({
  items,
  selectedId,
  setSelectedId,
  setSuppressedDeletedIds,
}: {
  items: JobItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setSuppressedDeletedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { markTaskComplete } = useGuide();
  const [error, setError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: JobStatus }) => {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update status");
      return json as {
        resumeSaved?: boolean;
        resumePdfUrl?: string | null;
        resumePdfName?: string | null;
        saveError?: { code: string; message: string } | null;
      };
    },
    onMutate: async ({ id, status }) => {
      setError(null);
      setUpdatingIds((prev) => new Set(prev).add(id));
      await queryClient.cancelQueries({ queryKey: ["jobs"] });

      const rollbackByQueryHash = new Map<string, JobsQueryRollbackPatch>();

      const queryCache = queryClient.getQueryCache().findAll({ queryKey: ["jobs"] });
      for (const query of queryCache) {
        const queryHash = query.queryHash;
        const key = query.queryKey;
        const currentFilter = getStatusFilterFromJobsQueryKey(key);
        const shouldKeep = currentFilter === "ALL" || currentFilter === status;

        queryClient.setQueryData<JobsResponse>(key, (old) => {
          if (!old || !Array.isArray(old.items)) return old;

          const previousIndex = old.items.findIndex((it) => it.id === id);
          if (previousIndex === -1) {
            return old;
          }

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
            totalCount:
              didRemove && typeof old.totalCount === "number"
                ? old.totalCount - 1
                : old.totalCount,
          };
        });
      }

      return { rollbackPatches: Array.from(rollbackByQueryHash.values()) };
    },
    onError: (e, _variables, context) => {
      for (const patch of context?.rollbackPatches ?? []) {
        queryClient.setQueryData<JobsResponse>(patch.queryKey, (old) =>
          restorePatchedJob(old, patch),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });

      setError(getErrorMessage(e, "Failed to update status"));
      toast({
        title: "Update failed",
        description: getErrorMessage(e, "The change could not be saved."),
        variant: "destructive",
        duration: 2200,
        className:
          "border-rose-200 bg-rose-50 text-rose-900 animate-in fade-in zoom-in-95",
      });
    },
    onSuccess: (data, variables) => {
      if (data?.resumeSaved || data?.resumePdfUrl) {
        markTaskComplete("generate_first_pdf");
      }
      toast({
        title: "Status updated",
        description: `${variables.status}`,
        duration: 1800,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });

      if (data?.resumePdfUrl) {
        const cachedEntries = queryClient.getQueriesData<JobsResponse>({ queryKey: ["jobs"] });
        for (const [entryKey] of cachedEntries) {
          queryClient.setQueryData<JobsResponse>(entryKey, (old) => {
            if (!old || !Array.isArray(old.items)) return old;
            return {
              ...old,
              items: old.items.map((it) =>
                it.id === variables.id
                  ? { ...it, resumePdfUrl: data.resumePdfUrl, resumePdfName: data.resumePdfName }
                  : it,
              ),
            };
          });
        }
      }

      if (data?.saveError) {
        toast({
          title: "Saved with warnings",
          description: data.saveError.message,
          duration: 2400,
          className:
            "border-amber-200 bg-amber-50 text-amber-900 animate-in fade-in zoom-in-95",
        });
      } else if (data?.resumeSaved) {
        toast({
          title: "Resume saved",
          description: "Saved to your applied job.",
          duration: 2000,
          className:
            "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
        });
      }
    },
    onSettled: (_data, _error, variables) => {
      if (!variables) return;
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (res.status === 404) {
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to delete job");
    },
    onMutate: async (id) => {
      setError(null);
      setSuppressedDeletedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setDeletingIds((prev) => new Set(prev).add(id));
      await queryClient.cancelQueries({ queryKey: ["jobs"] });
      const previousSelectedId = selectedId;
      let nextSelectedId = selectedId;
      if (selectedId === id) {
        nextSelectedId = items.find((it) => it.id !== id)?.id ?? null;
      }
      const rollbackByQueryHash = new Map<string, JobsQueryRollbackPatch>();

      const queryCache = queryClient.getQueryCache().findAll({ queryKey: ["jobs"] });
      for (const query of queryCache) {
        const key = query.queryKey;
        const queryHash = query.queryHash;
        queryClient.setQueryData<JobsResponse>(key, (old) => {
          if (!old || !Array.isArray(old.items)) return old;

          const previousIndex = old.items.findIndex((it) => it.id === id);
          if (previousIndex === -1) {
            return old;
          }
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

          const nextItems = old.items.filter((it) => it.id !== id);

          return {
            ...old,
            items: nextItems,
            totalCount: typeof old.totalCount === "number" ? old.totalCount - 1 : old.totalCount,
          };
        });
      }

      if (selectedId === id) {
        setSelectedId(nextSelectedId);
      }

      return {
        rollbackPatches: Array.from(rollbackByQueryHash.values()),
        previousSelectedId,
      };
    },
    onError: (e, id, context) => {
      setError(getErrorMessage(e, "Failed to delete job"));
      if (id) {
        setSuppressedDeletedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      for (const patch of context?.rollbackPatches ?? []) {
        queryClient.setQueryData<JobsResponse>(patch.queryKey, (old) =>
          restorePatchedJob(old, patch),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });

      if (context && "previousSelectedId" in context) {
        setSelectedId(context.previousSelectedId ?? null);
      }
      toast({
        title: "Delete failed",
        description: getErrorMessage(e, "The job could not be removed."),
        variant: "destructive",
        duration: 2400,
        className:
          "border-rose-200 bg-rose-50 text-rose-900 animate-in fade-in zoom-in-95",
      });
    },
    onSuccess: () => {
      toast({
        title: "Job deleted",
        description: "The role was removed.",
        duration: 1800,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });
    },
    onSettled: (_data, _error, id) => {
      if (!id) return;
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  });

  function updateStatus(id: string, status: JobStatus) {
    const previous = items.find((it) => it.id === id)?.status;
    if (!previous || previous === status) return;
    updateStatusMutation.mutate({ id, status });
  }

  return {
    updateStatus,
    deleteMutation,
    updatingIds,
    deletingIds,
    error,
    setError,
  };
}
