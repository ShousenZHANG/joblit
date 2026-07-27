"use client";

import { useCallback, useRef, useState, type RefObject } from "react";

import { sessionDeletedJobIds } from "./useJobMutations";

/**
 * Rows hidden from the list while a delete is pending, and the scroll
 * compensation that goes with hiding them.
 *
 * Hiding a row was two calls at six sites in `useJobMutations` —
 * `captureListViewport(excluded)` followed by `setSuppressedDeletedIds(...)` —
 * each repeating the same set add/remove logic, with the anchor ref and the
 * restore effect living in `JobsClient` a few hundred lines away. `hideJobs`
 * and `revealJobs` are the whole operation, so a caller cannot perform half of
 * it, and the machinery is testable without rendering the workspace.
 *
 * A note on the ordering, because it looks like it should matter: capture
 * measures a row that is about to disappear, so it reads as though it must run
 * before the suppression. It does not, and the suite says so — inverting the
 * two inside `hideJobs` leaves every test green, including the integration case
 * that asserts a real `scrollTop`. React batches the state update, so the DOM
 * is unchanged until the render that follows this callback; both orderings
 * measure the same document. Capture stays first because it reads better, not
 * because anything depends on it.
 */

interface ViewportAnchor {
  jobId: string | null;
  offsetTop: number;
  scrollTop: number;
}

export interface SuppressedJobRows {
  /** Ids currently hidden from the list. Stable identity when unchanged. */
  suppressedDeletedIds: ReadonlySet<string>;
  /** Hide rows, anchoring the viewport against a row that is staying. */
  hideJobs: (ids: Iterable<string>) => void;
  /** Un-hide rows — a failed commit, or an undo. */
  revealJobs: (ids: Iterable<string>) => void;
  /**
   * Re-apply the anchor captured by the last hide or reveal. The caller runs
   * this in a layout effect keyed on the visible rows, which is knowledge this
   * hook does not have: the visible list is derived from `suppressedDeletedIds`,
   * so taking it as an argument would be circular.
   */
  restoreAnchor: () => void;
}

export function useSuppressedJobRows(input: {
  scrollRef: RefObject<HTMLDivElement | null>;
}): SuppressedJobRows {
  const { scrollRef } = input;
  // Seed from the session tombstones so a remount (SPA nav away and back) keeps
  // already-committed deletes hidden while a flushed DELETE is still in flight.
  const [suppressedDeletedIds, setSuppressedDeletedIds] = useState<Set<string>>(
    () => new Set(sessionDeletedJobIds),
  );
  const anchorRef = useRef<ViewportAnchor | null>(null);

  const findViewport = useCallback(
    () =>
      scrollRef.current?.querySelector<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      ) ?? null,
    [scrollRef],
  );

  const captureAnchor = useCallback(
    (excludedIds: ReadonlySet<string>) => {
      const viewport = findViewport();
      if (!viewport) return;
      // Compensation below is against a stable row identity, so disable native
      // overflow anchoring — otherwise Chrome applies a second, competing
      // correction for the same DOM change.
      viewport.style.overflowAnchor = "none";

      const viewportRect = viewport.getBoundingClientRect();
      const viewportTop = viewportRect.top;
      const anchor = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-job-id]"),
      ).find((row) => {
        const id = row.dataset.jobId;
        if (!id || excludedIds.has(id)) return false;
        const rowRect = row.getBoundingClientRect();
        return rowRect.bottom > viewportTop && rowRect.top < viewportRect.bottom;
      });

      anchorRef.current = {
        jobId: anchor?.dataset.jobId ?? null,
        offsetTop: anchor
          ? anchor.getBoundingClientRect().top - viewportTop
          : 0,
        scrollTop: viewport.scrollTop,
      };
    },
    [findViewport],
  );

  const hideJobs = useCallback(
    (ids: Iterable<string>) => {
      const hidden = new Set(ids);
      if (hidden.size === 0) return;
      // Anchor against a row that is staying: the ones leaving cannot hold a
      // position after this render.
      captureAnchor(hidden);
      setSuppressedDeletedIds((previous) => {
        const missing = [...hidden].filter((id) => !previous.has(id));
        if (missing.length === 0) return previous;
        const next = new Set(previous);
        for (const id of missing) next.add(id);
        return next;
      });
    },
    [captureAnchor],
  );

  const revealJobs = useCallback(
    (ids: Iterable<string>) => {
      const revealed = new Set(ids);
      if (revealed.size === 0) return;
      // Nothing is leaving, so any visible row is a valid anchor.
      captureAnchor(new Set());
      setSuppressedDeletedIds((previous) => {
        const present = [...revealed].filter((id) => previous.has(id));
        if (present.length === 0) return previous;
        const next = new Set(previous);
        for (const id of present) next.delete(id);
        return next;
      });
    },
    [captureAnchor],
  );

  const restoreAnchor = useCallback(() => {
    const snapshot = anchorRef.current;
    if (!snapshot) return;
    anchorRef.current = null;

    const viewport = findViewport();
    if (!viewport) return;

    if (snapshot.jobId) {
      const anchor = viewport.querySelector<HTMLElement>(
        `[data-job-id="${CSS.escape(snapshot.jobId)}"]`,
      );
      if (anchor) {
        const viewportTop = viewport.getBoundingClientRect().top;
        const nextOffsetTop = anchor.getBoundingClientRect().top - viewportTop;
        viewport.scrollTop += nextOffsetTop - snapshot.offsetTop;
        return;
      }
    }
    // The anchored row went away too; fall back to the raw offset.
    viewport.scrollTop = snapshot.scrollTop;
  }, [findViewport]);

  return { suppressedDeletedIds, hideJobs, revealJobs, restoreAnchor };
}
