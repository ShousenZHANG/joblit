"use client";

import { useEffect, useState } from "react";

/**
 * Runner liveness, polled from credential activity.
 *
 * `lastUsedAt` refreshes on every authenticated Runner call behind a
 * five-minute server-side write throttle, so ONLINE_WINDOW_MS must stay wider
 * than that throttle or a healthy Runner would flicker offline between
 * writes.
 */
const ONLINE_WINDOW_MS = 6 * 60 * 1000;
const POLL_MS = 60 * 1000;

export type RunnerPresence =
  | { status: "unknown" }
  | { status: "offline"; lastUsedAt: Date | null }
  | { status: "online"; lastUsedAt: Date; minutesAgo: number };

export function useRunnerPresence(enabled: boolean): RunnerPresence {
  const [presence, setPresence] = useState<RunnerPresence>({
    status: "unknown",
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;

    async function poll() {
      try {
        const res = await fetch("/api/agent/presence", {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`status=${res.status}`);
        const json: { lastUsedAt: string | null } = await res.json();
        if (controller.signal.aborted) return;
        if (!json.lastUsedAt) {
          setPresence({ status: "offline", lastUsedAt: null });
        } else {
          const lastUsedAt = new Date(json.lastUsedAt);
          const ageMs = Date.now() - lastUsedAt.getTime();
          setPresence(
            ageMs <= ONLINE_WINDOW_MS
              ? {
                  status: "online",
                  lastUsedAt,
                  minutesAgo: Math.max(0, Math.floor(ageMs / 60_000)),
                }
              : { status: "offline", lastUsedAt },
          );
        }
      } catch {
        if (controller.signal.aborted) return;
        // A failed poll is not evidence of an offline Runner — say nothing
        // rather than something false.
        setPresence({ status: "unknown" });
      }
      timer = window.setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);

  return presence;
}
