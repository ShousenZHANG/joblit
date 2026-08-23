"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ResumeProfileSchema } from "@/lib/shared/schemas/resumeProfile";
import type { PreviewStatus, ResumeProfilePayload } from "./types";

/**
 * Floor on the gap between two compiles.
 *
 * The editor refreshes as the user types, and a LaTeX compile is the most
 * expensive request the app makes. The debounce alone only measures the pause
 * before a compile; this measures the gap between compiles, so a burst of
 * short pauses in a long editing run still costs one render every few seconds
 * rather than one per pause.
 */
const PREVIEW_MIN_INTERVAL_MS = 4000;

interface UseResumePreviewParams {
  buildPayload: (mode: "preview" | "save") => ResumeProfilePayload;
  hasAnyContent: boolean;
  t: (key: string) => string;
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
}

export function useResumePreview({
  buildPayload,
  hasAnyContent,
  t,
  toast,
}: UseResumePreviewParams) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  // The payload key the on-screen PDF was actually built from. Advances only
  // on a successful compile, so a failed one correctly leaves the caller's
  // "unpreviewed changes" badge lit. `previewLatestKeyRef` cannot serve this:
  // a ref change does not re-render the badge.
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);

  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewScheduledKeyRef = useRef<string | null>(null);
  const previewInFlightKeyRef = useRef<string | null>(null);
  const previewLatestKeyRef = useRef<string | null>(null);
  // Mirror pdfUrl into a ref so schedulePreview reads the latest value
  // without listing pdfUrl as a useCallback dependency. Avoids
  // re-instantiating schedulePreview on every PDF blob change and
  // ensures the async error handler reads the current state, not the
  // value captured at call time.
  const pdfUrlRef = useRef<string | null>(null);
  useEffect(() => {
    pdfUrlRef.current = pdfUrl;
  }, [pdfUrl]);

  /** When the last compile was dispatched, for the minimum-interval floor. */
  const lastRunAtRef = useRef(0);
  /**
   * Set when the server rate-limits us. The editor then stops compiling on its
   * own and waits for the next explicit refresh: the preview is already marked
   * stale by the caller's badge, and an error banner for a limit the user
   * cannot see or act on is noise, not information.
   */
  const rateLimitedUntilRef = useRef(0);

  // cleanup timer and abort on unmount
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewAbortRef.current?.abort();
    };
  }, []);

  // revoke object URL on change
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const schedulePreview = useCallback(
    (
      delayMs = 800,
      showEmptyToast = false,
      options?: {
        payload?: ResumeProfilePayload;
        payloadKey?: string;
        force?: boolean;
        /**
         * Subject to the minimum-interval floor. Set by the typing refresh
         * only: an explicit commit — leaving a field, changing section, or
         * pressing Refresh — is the user saying "now", and making that wait
         * out a cooldown would be the very unresponsiveness this is meant to
         * avoid.
         */
        throttled?: boolean;
      },
    ) => {
      if (!hasAnyContent) {
        if (showEmptyToast) {
          toast({
            title: t("toastAddDetailsFirst"),
            description: t("toastAddDetailsFirstDesc"),
            variant: "destructive",
          });
        }
        return;
      }

      const payload = options?.payload ?? buildPayload("preview");

      // Mid-typing states (a half-entered email/url/phone, a partially filled
      // row) fail the shared ResumeProfileSchema the server enforces, so a
      // keystroke-driven preview would POST a body the server 400s on — which
      // flashes a generic "preview failed" error and spams 400s in the logs.
      // Validate against the same schema first: if the draft isn't renderable
      // yet, hold the last good preview and skip the request. A manual refresh
      // (force) still goes through so the user gets explicit feedback.
      if (!options?.force && !ResumeProfileSchema.safeParse(payload).success) {
        return;
      }

      const payloadKey = options?.payloadKey ?? JSON.stringify(payload);
      const shouldSkip =
        !options?.force &&
        (payloadKey === previewScheduledKeyRef.current ||
          payloadKey === previewInFlightKeyRef.current ||
          payloadKey === previewLatestKeyRef.current);
      if (shouldSkip) return;

      // Sit out a server-imposed cooldown rather than hammering it. A forced
      // refresh is the user asking explicitly, so it always goes through.
      if (!options?.force && Date.now() < rateLimitedUntilRef.current) return;

      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewAbortRef.current?.abort();

      // Hold a compile back to the minimum interval instead of dropping it, so
      // the last thing typed still reaches the preview — just later.
      const sinceLastRun = Date.now() - lastRunAtRef.current;
      const effectiveDelay = options?.throttled
        ? Math.max(delayMs, PREVIEW_MIN_INTERVAL_MS - sinceLastRun)
        : delayMs;

      // Always announce the compile. The old code reported "ready" for
      // background refreshes because keystroke-driven compiles would strobe
      // the spinner several times a second. Refreshes are commit-driven now —
      // one per field the user finishes — so staying silent while the picture
      // is about to change is the dishonest option. Nothing flickers: the
      // skeleton is gated on `!pdfUrl`, so a stale preview stays painted and
      // only the Refresh control shows motion.
      setPreviewStatus("loading");
      setPreviewError(null);
      previewScheduledKeyRef.current = payloadKey;

      const runPreview = async (attempt: number) => {
        previewScheduledKeyRef.current = null;
        previewInFlightKeyRef.current = payloadKey;
        lastRunAtRef.current = Date.now();
        const controller = new AbortController();
        previewAbortRef.current = controller;
        try {
          const res = await fetch("/api/resume-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!res.ok) {
            // Rate limiting is not a failure the user can act on: they cannot
            // see the budget, and the draft is already flagged as unpreviewed.
            // Back off quietly, keep the last good PDF painted, and let the
            // next commit or an explicit refresh try again.
            if (res.status === 429) {
              const retryAfter = Number(res.headers.get("retry-after"));
              rateLimitedUntilRef.current =
                Date.now() +
                (Number.isFinite(retryAfter) && retryAfter > 0
                  ? retryAfter * 1000
                  : PREVIEW_MIN_INTERVAL_MS * 2);
              setPreviewStatus(pdfUrlRef.current ? "ready" : "idle");
              return;
            }

            let message = t("previewFailed");
            let code: string | undefined;
            if (res.headers.get("content-type")?.includes("application/json")) {
              const json = await res.json().catch(() => null);
              code = json?.error?.code;
              if (code === "LATEX_RENDER_CONFIG_MISSING") {
                message = t("previewNotConfigured");
              } else if (code === "LATEX_RENDER_TIMEOUT") {
                message = t("previewTimeout");
              } else if (code === "LATEX_RENDER_UNREACHABLE") {
                message = t("previewUnavailable");
              } else if (code === "LATEX_RENDER_FAILED") {
                message = t("previewCompileFailed");
              } else if (code === "NO_PROFILE") {
                message = t("previewSaveFirst");
              }
            }

            if (attempt === 0 && [502, 503, 504].includes(res.status)) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              return runPreview(1);
            }

            // Read the latest pdfUrl at error-handling time, not the value
            // captured when schedulePreview was first called.
            if (!pdfUrlRef.current) {
              setPreviewError(message);
              setPreviewStatus("error");
            }
            return;
          }

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          setPreviewStatus("ready");
          rateLimitedUntilRef.current = 0;
          previewLatestKeyRef.current = payloadKey;
          setPreviewedKey(payloadKey);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          if (!pdfUrlRef.current) {
            setPreviewError(t("previewFailed"));
            setPreviewStatus("error");
          }
        } finally {
          if (previewInFlightKeyRef.current === payloadKey) {
            previewInFlightKeyRef.current = null;
          }
          previewAbortRef.current = null;
        }
      };

      previewTimerRef.current = setTimeout(() => {
        runPreview(0);
      }, effectiveDelay);
    },
    [buildPayload, hasAnyContent, toast, t],
  );

  const resetPreview = useCallback(() => {
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewStatus("idle");
    setPreviewError(null);
    previewLatestKeyRef.current = null;
    setPreviewedKey(null);
  }, []);

  return {
    pdfUrl,
    setPdfUrl,
    previewedKey,
    previewStatus,
    setPreviewStatus,
    previewError,
    setPreviewError,
    schedulePreview,
    resetPreview,
  };
}

export type UseResumePreviewReturn = ReturnType<typeof useResumePreview>;
