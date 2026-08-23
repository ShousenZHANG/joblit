"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Silent autosave for the resume editor.
 *
 * The editor used to demand a manual Save press, with an amber dot nagging
 * about unsaved work — the user carried the burden of remembering. Every
 * current resume builder (and GitHub Primer's own guidance: never mix explicit
 * and automatic saving in one form) settles on quiet autosave instead.
 *
 * Dirtiness is decided by the caller, not here: the editor already tracks a
 * "last persisted snapshot" baseline that gets re-set both on save and on
 * version hydrate. Reusing it is what stops a freshly-loaded resume from
 * immediately saving itself back.
 *
 * Semantics that matter:
 * - Debounced by `delayMs` from the last edit, so a burst of keystrokes costs
 *   one request.
 * - Single-flight. An edit landing mid-save never starts a second request; the
 *   caller's baseline stays dirty, and the next scheduling pass picks it up.
 * - Flushed on blur and on `beforeunload`, so leaving the field or the tab
 *   cannot strand an edit inside the debounce window.
 * - A failure never discards data: status flips to `error` and the newest
 *   draft is retried on the next edit or an explicit retry.
 */

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

interface UseResumeAutosaveOptions {
  /** Serialized live draft — changes whenever the user edits anything. */
  saveKey: string;
  /** True when the live draft differs from the last persisted snapshot. */
  isDirty: boolean;
  /** False while the draft is empty — nothing worth persisting yet. */
  enabled: boolean;
  /** Persists the current draft. Must reject on failure. */
  save: () => Promise<void>;
  delayMs?: number;
}

export interface UseResumeAutosaveReturn {
  status: AutosaveStatus;
  /**
   * Epoch ms of the last successful save, or null if nothing has been
   * persisted this session. The indicator turns this into "just now" / "3m
   * ago": a bare "Saved" that never changes reads as decoration and stops
   * being looked at, which is exactly how this indicator went unnoticed.
   */
  lastSavedAt: number | null;
  /** True while an edit is waiting out the debounce or a save is in flight. */
  pending: boolean;
  /**
   * Persist immediately, skipping the debounce. Resolves true when the draft
   * is safely persisted (or there was nothing to persist), false when the save
   * failed — callers about to discard the draft must check this.
   */
  flush: () => Promise<boolean>;
}

const DEFAULT_DELAY_MS = 800;

export function useResumeAutosave({
  saveKey,
  isDirty,
  enabled,
  save,
  delayMs = DEFAULT_DELAY_MS,
}: UseResumeAutosaveOptions): UseResumeAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Latest values, read by timers and unload handlers that outlive the render
  // which created them. Synced in an effect rather than during render: a
  // debounced callback only ever fires after the commit that scheduled it, so
  // an effect-time sync is always current by the time anything reads these.
  const saveRef = useRef(save);
  const dirtyRef = useRef(isDirty);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    saveRef.current = save;
    dirtyRef.current = isDirty;
    enabledRef.current = enabled;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const inFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    if (!enabledRef.current || !dirtyRef.current) return true;
    // Single-flight: wait on the run already in progress rather than starting a
    // second one. The caller's baseline stays dirty if this edit missed it,
    // which reschedules us.
    if (inFlightRef.current) return inFlightPromiseRef.current ?? false;

    inFlightRef.current = true;
    if (mountedRef.current) setStatus("saving");
    const attempt = (async () => {
      try {
        await saveRef.current();
        if (mountedRef.current) {
          setStatus("saved");
          setLastSavedAt(Date.now());
        }
        return true;
      } catch {
        // Keep the draft. The next edit — or the retry affordance — saves the
        // newest state; nothing is dropped here.
        if (mountedRef.current) setStatus("error");
        return false;
      } finally {
        inFlightRef.current = false;
        inFlightPromiseRef.current = null;
      }
    })();
    inFlightPromiseRef.current = attempt;
    return attempt;
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return run();
  }, [run]);

  // Schedule on every dirty draft change. Keyed on isDirty as well as saveKey
  // so a mid-save edit (which leaves the baseline dirty once the in-flight run
  // settles) gets picked up without a second user keystroke.
  useEffect(() => {
    if (!enabled || !isDirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void run();
    }, delayMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [saveKey, isDirty, enabled, delayMs, run]);

  // Leaving the field or the page must not strand an edit inside the debounce.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBlurCapture = () => {
      if (!enabledRef.current || !dirtyRef.current) return;
      void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !inFlightRef.current) return;
      void flush();
      // The flush is asynchronous, so still ask the browser to confirm —
      // otherwise the tab can close before the request leaves.
      event.preventDefault();
    };
    window.addEventListener("blur", onBlurCapture, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("blur", onBlurCapture, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush]);

  return {
    status,
    lastSavedAt,
    pending: isDirty || status === "saving",
    flush,
  };
}
