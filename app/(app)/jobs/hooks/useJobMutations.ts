import { createElement, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { useGuide } from "@/app/GuideContext";
import type { JobItem, JobStatus } from "../types";
import { getErrorMessage } from "../types";
import { createSerialRunner } from "./serialRunner";
import {
  cancelJobsQueries,
  getJobDetailsQueryKey,
  invalidateActiveJobsQueries,
  patchJobStatusInJobsCache,
  removeJobFromJobsCache,
  restoreJobsSnapshots,
} from "../utils/jobsQueryCache";

// Undo window for single-job deletes. The server DELETE is deferred until this
// elapses so the action stays reversible without a confirm modal.
const UNDO_WINDOW_MS = 5000;

// Session-scoped tombstones: every id whose delete COMMITTED this session.
// Module-level so it survives JobsClient unmount/remount (SPA nav away and
// back) — the component-level suppression set dies with the component, and a
// flushed DELETE can still be in flight when the remounted list refetches,
// briefly resurrecting the row without this seed. Ids are never reused
// (cuid + DeletedJobUrl import tombstone), so entries can only ever mask
// genuinely-deleted rows. Cleared by a full page load, where the server is
// the source of truth anyway.
export const sessionDeletedJobIds = new Set<string>();

type PendingDelete = {
  timer: ReturnType<typeof setTimeout>;
  restoreSelection: boolean;
  replacementSelectionId: string | null;
};

export function useJobMutations({
  items,
  selectedId,
  setSelectedId,
  hideJobs,
  revealJobs,
}: {
  items: JobItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  hideJobs: (ids: Iterable<string>) => void;
  revealJobs: (ids: Iterable<string>) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const t = useTranslations("jobs");
  const { markTaskComplete } = useGuide();
  const [error, setError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: JobStatus }) => {
      return (await fetchJson(`/api/jobs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
        fallbackError: "Failed to update status",
      })) as { ok?: boolean };
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
    onSuccess: (_data, variables) => {
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
  // only once a commit succeeds (finalizeDelete) — and after a successful
  // commit the id stays suppressed for the rest of the session (a tombstone,
  // matching the batch-delete path) so a stale in-flight list response can
  // never resurrect the row. Undo cancels the timer and un-hides the row — no
  // DELETE, no tombstone. Pending deletes are flushed on unmount/pagehide so
  // leaving the page can't drop a delete in its window.
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
        try {
          await fetchJson(`/api/jobs/${id}`, {
            method: "DELETE",
            fallbackError: "Failed to delete job",
          });
        } catch (err) {
          // A 404 means the row is already gone, which is the outcome we want.
          if (!(err instanceof ApiError) || err.status !== 404) throw err;
        }
        // Commit succeeded — kill any in-flight list fetches FIRST. They were
        // dispatched before the server delete, so their (stale) payload still
        // contains this row; letting them land after the cache edit below
        // would write the deleted row straight back.
        await cancelJobsQueries(queryClient);
        // Only NOW remove the row from the cache and decrement totalCount. Up
        // to here the row was merely hidden via suppressedDeletedIds, so the
        // cache stayed untouched and concurrent pending deletes/undos never
        // interfered with each other.
        removeJobFromJobsCache(queryClient, id);
        queryClient.removeQueries({
          queryKey: getJobDetailsQueryKey(id),
          exact: true,
        });
        // The id stays in suppressedDeletedIds for the rest of the session —
        // a tombstone, exactly like the batch-delete success path. This is the
        // rapid-delete resurrection fix: a list response that raced past the
        // cancel above (or any later stale payload) may re-insert the row into
        // the cache, but the render layer filters suppressed ids out of both
        // the rows and the visible count, so it can never reappear. Un-hiding
        // here (the previous behaviour) opened exactly that window. The set is
        // session-bounded and ids are never reused (cuid + DeletedJobUrl
        // tombstone keeps re-imports out), so nothing legitimate is masked.
        sessionDeletedJobIds.add(id);
      } catch (e) {
        // Commit failed — un-hide so the row reappears. The cache was never
        // mutated during the window, so there is no snapshot to restore.
        revealJobs([id]);
        if (
          pending.restoreSelection &&
          (
            selectedIdRef.current === pending.replacementSelectionId ||
            selectedIdRef.current === null
          )
        ) {
          setSelectedId(id);
        }
        setError(getErrorMessage(e, "Failed to delete job"));
        toast({
          title: t("deleteFailedTitle"),
          description: t("deleteFailedRestored"),
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
    [queryClient, revealJobs, setSelectedId, toast, t],
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
      revealJobs([id]);
      if (
        pending.restoreSelection &&
        (
          selectedIdRef.current === pending.replacementSelectionId ||
          selectedIdRef.current === null
        )
      ) {
        setSelectedId(id);
      }
    },
    [revealJobs, setSelectedId],
  );

  const requestDelete = useCallback(
    (job: JobItem) => {
      const id = job.id;
      if (pendingDeletesRef.current.has(id) || deletingIds.has(id)) return;
      setError(null);
      const currentIndex = items.findIndex((item) => item.id === id);
      const adjacent =
        items[currentIndex + 1] ??
        items[currentIndex - 1] ??
        items.find((item) => item.id !== id) ??
        null;
      hideJobs([id]);
      if (selectedId === id) {
        setSelectedId(adjacent?.id ?? null);
      }
      // No cache mutation here — the row is hidden via suppressedDeletedIds
      // above. The cache is only touched if/when the commit succeeds.
      const timer = setTimeout(() => {
        // Route through the serial runner so simultaneous timer expiries commit
        // one-at-a-time instead of bursting parallel requests at the backend.
        void commitRunnerRef.current(() => finalizeDelete(id));
      }, UNDO_WINDOW_MS);
      pendingDeletesRef.current.set(id, {
        timer,
        restoreSelection: selectedId === id,
        replacementSelectionId: adjacent?.id ?? null,
      });
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
        title: t("jobRemovedFromList"),
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
      hideJobs,
      setSelectedId,
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
        // Tombstone BEFORE the fire-and-forget DELETE: if the user SPA-navigates
        // back to Jobs while this request is still in flight, the remounted
        // list seeds its suppression set from sessionDeletedJobIds and the row
        // can't flash back while the server catches up.
        sessionDeletedJobIds.add(id);
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

  // Stable reference: memoized rows/panels receive this — a per-render
  // function identity would re-render them all on every parent update.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const mutateStatus = updateStatusMutation.mutate;
  const updateStatus = useCallback(
    (id: string, status: JobStatus) => {
      const previous = itemsRef.current.find((it) => it.id === id)?.status;
      if (!previous || previous === status) return;
      mutateStatus({ id, status });
    },
    [mutateStatus],
  );

  return {
    updateStatus,
    requestDelete,
    updatingIds,
    deletingIds,
    error,
    setError,
  };
}
