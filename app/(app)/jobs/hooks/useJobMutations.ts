import { createElement, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { useGuide } from "@/app/GuideContext";
import type { JobItem, JobStatus } from "../types";
import { getErrorMessage } from "../types";
import { runChunkedBatchDelete } from "./runChunkedBatchDelete";
import { createSerialRunner } from "./serialRunner";
import {
  cancelJobsQueries,
  invalidateActiveJobsQueries,
  patchGeneratedJobArtifactInJobsCache,
  patchJobStatusInJobsCache,
  removeJobFromJobsCache,
  removeJobsFromJobsCache,
  restoreJobsSnapshots,
} from "../utils/jobsQueryCache";

// Undo window for single-job deletes. The server DELETE is deferred until this
// elapses so the action stays reversible without a confirm modal.
const UNDO_WINDOW_MS = 5000;

type PendingDelete = {
  timer: ReturnType<typeof setTimeout>;
};

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
  const t = useTranslations("jobs");
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
      return { rollbackSnapshots: patchJobStatusInJobsCache(queryClient, id, status) };
    },
    onError: (e, _variables, context) => {
      restoreJobsSnapshots(queryClient, context?.rollbackSnapshots);
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

  // Single-job delete uses a deferred-commit "undo" pattern (Gmail/Linear
  // style) instead of a confirm modal. During the undo window the row is hidden
  // purely via `suppressedDeletedIds` — the react-query cache is NOT mutated and
  // NO snapshot is taken. This is what makes concurrent pending deletes safe:
  // each row is hidden/unhidden independently, so undoing one delete can't
  // clobber another (the old whole-cache snapshot/restore could resurrect or
  // drop sibling pending rows when undone out of order). The cache is mutated
  // only once a commit succeeds (finalizeDelete). Undo cancels the timer and
  // un-hides the row — no DELETE, no tombstone. Pending deletes are flushed on
  // unmount/pagehide so leaving the page can't drop a delete in its window.
  const pendingDeletesRef = useRef<Map<string, PendingDelete>>(new Map());
  // Serialises the deferred commits so a burst of rapidly-deleted rows can't
  // fire parallel DELETEs and spike Neon's connection pool — one in flight at
  // a time, in click order. (Exit flushes bypass this; see the unmount effect.)
  const commitRunnerRef = useRef(createSerialRunner());

  const finalizeDelete = useCallback(
    async (id: string) => {
      const pending = pendingDeletesRef.current.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingDeletesRef.current.delete(id);
      setDeletingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
        if (res.status !== 404 && !res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || "Failed to delete job");
        }
        // Commit succeeded — only NOW remove the row from the cache and
        // decrement totalCount. Up to here the row was merely hidden via
        // suppressedDeletedIds, so the cache stayed untouched and concurrent
        // pending deletes/undos never interfered with each other.
        removeJobFromJobsCache(queryClient, id);
      } catch (e) {
        // Commit failed — un-hide so the row reappears. The cache was never
        // mutated during the window, so there is no snapshot to restore.
        setSuppressedDeletedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        invalidateActiveJobsQueries(queryClient);
        setError(getErrorMessage(e, "Failed to delete job"));
        toast({
          title: "Delete failed",
          description: getErrorMessage(e, "The job could not be removed."),
          variant: "destructive",
          duration: 2400,
          className:
            "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
        });
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [queryClient, setSuppressedDeletedIds, toast],
  );

  const undoDelete = useCallback(
    (id: string) => {
      const pending = pendingDeletesRef.current.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingDeletesRef.current.delete(id);
      // Cache was never mutated (row only hidden via suppressedDeletedIds), so
      // undo just un-hides it. No snapshot restore => overlapping undos in any
      // order can't clobber each other.
      setSuppressedDeletedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedId(id);
    },
    [setSelectedId, setSuppressedDeletedIds],
  );

  const requestDelete = useCallback(
    (job: JobItem) => {
      const id = job.id;
      if (pendingDeletesRef.current.has(id) || deletingIds.has(id)) return;
      setError(null);
      setSuppressedDeletedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      void cancelJobsQueries(queryClient);
      if (selectedId === id) {
        setSelectedId(items.find((it) => it.id !== id)?.id ?? null);
      }
      // No cache mutation here — the row is hidden via suppressedDeletedIds
      // above. The cache is only touched if/when the commit succeeds.
      const timer = setTimeout(() => {
        // Route through the serial runner so simultaneous timer expiries commit
        // one-at-a-time instead of bursting parallel requests at the backend.
        void commitRunnerRef.current(() => finalizeDelete(id));
      }, UNDO_WINDOW_MS);
      pendingDeletesRef.current.set(id, { timer });
      // Premium undo toast (Gmail/Linear): a NEUTRAL surface — a delete isn't a
      // "success", so the previous emerald-green styling was semantically
      // wrong — an emerald Undo that pops, and a countdown bar that visibly
      // drains over the undo window so the user can see how long the action
      // stays reversible. `dismissThis` lets Undo close the toast immediately
      // rather than lingering with a stale "deleted" message after restore.
      let dismissThis = () => {};
      const countdownBar = createElement("span", {
        "aria-hidden": true,
        className:
          "toast-countdown-bar pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-brand-emerald-400 to-brand-emerald-500",
        style: { animationDuration: `${UNDO_WINDOW_MS}ms` },
      });
      const handle = toast({
        title: t("jobDeleted"),
        description: createElement(Fragment, null, job.title, countdownBar),
        duration: UNDO_WINDOW_MS,
        className:
          "group border-border/60 bg-card/95 text-foreground shadow-[0_20px_50px_-20px_rgba(15,23,42,0.45)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2",
        // shadcn's ToastActionElement type puts the component in the props
        // slot, so it only matches JSX; createElement needs the unknown cast.
        action: createElement(
          ToastAction,
          {
            altText: t("undoAria"),
            onClick: () => {
              undoDelete(id);
              dismissThis();
            },
            className:
              "border-brand-emerald-500 bg-brand-emerald-500 text-white shadow-sm transition-colors hover:border-brand-emerald-600 hover:bg-brand-emerald-600",
          },
          t("undo"),
        ) as unknown as ToastActionElement,
      });
      dismissThis = handle.dismiss;
    },
    [
      deletingIds,
      items,
      selectedId,
      queryClient,
      setSelectedId,
      setSuppressedDeletedIds,
      finalizeDelete,
      undoDelete,
      toast,
      t,
    ],
  );

  // Flush pending deletes when the user actually leaves the page, so a deferred
  // delete inside its undo window still reaches the server. Two triggers:
  //   - React unmount (SPA navigation away from the jobs view), and
  //   - `pagehide` (tab close, reload, or full navigation) — without it, a
  //     delete + close-tab within the 5s window would silently resurrect on
  //     next load because the timer never fired.
  // `keepalive` lets the request outlive the document. We deliberately do NOT
  // listen to `visibilitychange`, since a mere tab switch is recoverable and
  // must not prematurely finalise a still-undoable delete. Flushed requests are
  // fire-and-forget + server-idempotent, so a double-send (pagehide then
  // unmount) is harmless — clearing the map after the first flush prevents it.
  useEffect(() => {
    const pending = pendingDeletesRef.current;
    const flush = () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        void fetch(`/api/jobs/${id}`, { method: "DELETE", keepalive: true });
      }
      pending.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

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
      const deleted = data.deleted;
      const failed = data.failedIds.length;

      if (failed > 0 && deleted > 0) {
        // Partial success only: refetch so the failed (un-suppressed) ids
        // re-appear with fresh server state. Full success skips the refetch
        // entirely — the optimistic removeJobsFromJobsCache() already removed
        // the rows + decremented totalCount, so invalidating would just dim
        // the list for no reason.
        void invalidateActiveJobsQueries(queryClient);
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
    requestDelete,
    batchDeleteMutation,
    updatingIds,
    deletingIds,
    error,
    setError,
  };
}
