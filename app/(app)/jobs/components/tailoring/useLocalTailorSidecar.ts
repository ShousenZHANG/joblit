"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives the local tailoring sidecar from the browser.
 *
 * Joblit's server never calls a model and never holds a model credential
 * (ADR-0015), and a serverless function cannot reach the operator's laptop, so
 * the page talks to a process on loopback instead. The sidecar returns the
 * same JSON a user would otherwise paste in by hand, which then goes through
 * the existing import path — the server's gates stay the only judge either way.
 *
 * Availability is unknowable until asked: the sidecar is a process someone
 * starts, so the button treats "not running" as an ordinary state with an
 * instruction, not an error.
 */

const DEFAULT_ORIGIN = "http://127.0.0.1:8791";

/**
 * The sidecar runs the model with `spawnSync`, so a wedged model call blocks
 * its event loop and it answers nothing further — not even /health. Without a
 * deadline the button would sit on "Generating…" forever with no way back,
 * and there is no manual path to fall back to any more. Generous enough for a
 * three-attempt repair loop on a long job description.
 */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export type SidecarPhase =
  | { phase: "prompt"; chars: number; job: string }
  | { phase: "generate"; attempt: number; of: number }
  | { phase: "rejected"; attempt: number; code: string; message: string };

export interface LocalTailorSidecar {
  /** True while a generation is in flight. */
  running: boolean;
  /** Latest progress event, for the button's label. */
  progress: SidecarPhase | null;
  /** Set when the last attempt failed; cleared when a new one starts. */
  error: string | null;
  /** True when the last failure was the sidecar being unreachable. */
  offline: boolean;
  generate: (input: { jobId: string; target: "resume" | "cover"; locale?: string }) => Promise<string | null>;
}

function sidecarOrigin(): string {
  if (typeof window === "undefined") return DEFAULT_ORIGIN;
  return window.localStorage.getItem("joblit.sidecarOrigin") ?? DEFAULT_ORIGIN;
}

export function useLocalTailorSidecar(): LocalTailorSidecar {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SidecarPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback<LocalTailorSidecar["generate"]>(
    async ({ jobId, target, locale }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const deadline = setTimeout(
        () => controller.abort(new DOMException("timeout", "TimeoutError")),
        REQUEST_TIMEOUT_MS,
      );
      setRunning(true);
      setProgress(null);
      setError(null);
      setOffline(false);

      try {
        const response = await fetch(`${sidecarOrigin()}/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, target, locale }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`sidecar returned ${response.status}`);
        }

        // Newline-delimited JSON: one event per line, no framing library on
        // either side.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let generated: string | null = null;
        let failure: string | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line) continue;

            const event = JSON.parse(line) as
              | SidecarPhase
              | { phase: "done"; ok: boolean; rawOutput?: string; aiContent?: unknown; note?: string; error?: string; rejections?: { code: string; message: string }[] };

            if (event.phase === "done") {
              if (event.ok && (event.rawOutput || event.aiContent)) {
                // The import boundary parses the RAW model shape — top-level
                // cvSummary/skillsSelection — with the same parser the
                // sidecar's gate ran, so the accepted bytes go through
                // verbatim. The aggregate fallback only serves a sidecar
                // older than this field; its import will be refused with the
                // shape error, which at least says what to restart.
                generated =
                  event.rawOutput ?? JSON.stringify(event.aiContent, null, 2);
              } else {
                const last = event.rejections?.at(-1);
                failure =
                  event.error ??
                  (last ? `${last.code}: ${last.message}` : `generation ${event.note ?? "failed"}`);
              }
              continue;
            }
            setProgress(event);
          }
        }

        if (failure) {
          setError(failure);
          return null;
        }
        return generated;
      } catch (caught) {
        if (controller.signal.aborted) {
          if (controller.signal.reason?.name === "TimeoutError") {
            setError("The local generator stopped responding.");
          }
          return null;
        }
        // A refused connection and a DNS-less loopback both surface as a
        // TypeError from fetch, and both mean the same thing to the user.
        const isUnreachable = caught instanceof TypeError;
        setOffline(isUnreachable);
        setError(
          isUnreachable
            ? "Local generator is not running."
            : caught instanceof Error
              ? caught.message
              : String(caught),
        );
        return null;
      } finally {
        clearTimeout(deadline);
        setRunning(false);
        abortRef.current = null;
      }
    },
    [],
  );

  // A generation outlives the dialog otherwise: the fetch keeps streaming into
  // a component nobody is looking at, and its state updates land on an
  // unmounted tree.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { running, progress, error, offline, generate };
}
