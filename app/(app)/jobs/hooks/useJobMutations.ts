import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import type { JobItem, JobStatus } from "../types";
import { getErrorMessage } from "../types";
import { runChunkedBatchDelete } from "./runChunkedBatchDelete";
import {
  cancelJobsQueries,
  invalidateActiveJobsQueries,
  patchGeneratedJobArtifactInJobsCache,
  patchJobStatusInJobsCache,
  removeJobFromJobsCache,
  removeJobsFromJobsCache,
  restoreJobsPatches,
  restoreJobsSnapshots,
} from "../utils/jobsQueryCache";

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
      await cancelJobsQueries(queryClient);
      return { rollbackPatches: patchJobStatusInJobsCache(queryClient, id, status) };
    },
    onError: (e, _variables, context) => {
      restoreJobsPatches(queryClient, context?.rollbackPatches);
      invalidateActiveJobsQueries(queryClient);

      setError(getErrorMessage(e, "Failed to update status"));
      toast({
        title: "Update failed",
        description: getErrorMessage(e, "The change could not be saved."),
        variant: "destructive",
        duration: 2200,
        className:
          "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
      });
    },
    onSuccess: (data, variables) => {
      if (data?.resumeSaved || data?.resumePdfUrl) {
        markTaskComplete("generate_first_pdf");
      }
      if (variables.status === "APPLIED") {
        markTaskComplete("mark_applied");
      }
      toast({
        title: "Status updated",
        description: `${variables.status}`,
        duration: 1800,
        className:
          "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
      });

      if (data?.resumePdfUrl) {
        patchGeneratedJobArtifactInJobsCache({
          queryClient,
          id: variables.id,
          patch: {
            resumePdfUrl: data.resumePdfUrl,
            resumePdfName: data.resumePdfName,
          },
        });
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
            "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
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
      await cancelJobsQueries(queryClient);
      const previousSelectedId = selectedId;
      let nextSelectedId = selectedId;
      if (selectedId === id) {
        nextSelectedId = items.find((it) => it.id !== id)?.id ?? null;
      }
      const rollbackPatches = removeJobFromJobsCache(queryClient, id);

      if (selectedId === id) {
        setSelectedId(nextSelectedId);
      }

      return {
        rollbackPatches,
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
      restoreJobsPatches(queryClient, context?.rollbackPatches);
      invalidateActiveJobsQueries(queryClient);

      if (context && "previousSelectedId" in context) {
        setSelectedId(context.previousSelectedId ?? null);
      }
      toast({
        title: "Delete failed",
        description: getErrorMessage(e, "The job could not be removed."),
        variant: "destructive",
        duration: 2400,
        className:
          "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
      });
    },
    onSuccess: () => {
      void invalidateActiveJobsQueries(queryClient);
      toast({
        title: "Job deleted",
        description: "The role was removed.",
        duration: 1800,
        className:
          "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
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

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Selections that exceed the server's per-request cap (100) used to
      // surface as a hard "Failed to batch delete" error. We now chunk
      // client-side, dispatch sequentially (so Neon's connection pool isn't
      // hammered), and aggregate the result. A single failed chunk does
      // NOT abort the whole operation — see runChunkedBatchDelete docstring.
      const summary = await runChunkedBatchDelete({
        ids,
        sendChunk: async (chunk) => {
          const res = await fetch("/api/jobs/batch-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: chunk }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(json?.error || "Failed to batch delete");
          }
          return json as { deleted: number; notFound: number };
        },
      });
      if (summary.failedIds.length > 0 && summary.deleted === 0) {
        // Every chunk failed — surface as a real error so onError runs and
        // the optimistic update gets rolled back fully.
        throw summary.firstError ?? new Error("Failed to batch delete");
      }
      return summary;
    },
    onMutate: async (ids) => {
      setError(null);
      const idSet = new Set(ids);
      setSuppressedDeletedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      setDeletingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      await cancelJobsQueries(queryClient);

      const previousSelectedId = selectedId;
      let nextSelectedId = selectedId;
      if (selectedId && idSet.has(selectedId)) {
        nextSelectedId = items.find((it) => !idSet.has(it.id))?.id ?? null;
      }

      const rollbackSnapshots = removeJobsFromJobsCache(queryClient, idSet);

      if (selectedId && idSet.has(selectedId)) {
        setSelectedId(nextSelectedId);
      }

      return { rollbackSnapshots, previousSelectedId };
    },
    onError: (e, ids, context) => {
      setError(getErrorMessage(e, "Failed to batch delete"));
      setSuppressedDeletedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      restoreJobsSnapshots(queryClient, context?.rollbackSnapshots);
      invalidateActiveJobsQueries(queryClient);
      if (context?.previousSelectedId) {
        setSelectedId(context.previousSelectedId);
      }
      toast({
        title: "Batch delete failed",
        description: getErrorMessage(e, "Some jobs could not be removed."),
        variant: "destructive",
        duration: 2400,
        className: "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
      });
    },
    onSuccess: (data, ids) => {
      // Refetch to get accurate totalCount and reset scroll trigger
      void invalidateActiveJobsQueries(queryClient);

      const deleted = data.deleted;
      const failed = data.failedIds.length;

      if (failed > 0 && deleted > 0) {
        // Partial success: report what worked + flag what didn't. Failed
        // ids are un-suppressed so they reappear in the list after refetch.
        setSuppressedDeletedIds((prev) => {
          const next = new Set(prev);
          for (const id of data.failedIds) next.delete(id);
          return next;
        });
        toast({
          title: `${deleted} of ${ids.length} jobs deleted`,
          description: `${failed} could not be removed — try again.`,
          variant: "destructive",
          duration: 3200,
          className: "border-amber-200 bg-amber-50 text-amber-900 animate-in fade-in zoom-in-95",
        });
        return;
      }

      toast({
        title: `${deleted} ${deleted === 1 ? "job" : "jobs"} deleted`,
        description: "The selected jobs were removed.",
        duration: 1800,
        className: "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
      });
    },
    onSettled: (_data, _error, ids) => {
      if (!ids) return;
      setDeletingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
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
    batchDeleteMutation,
    updatingIds,
    deletingIds,
    error,
    setError,
  };
}
