"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Presence is one shared observation, not one answer per component. The nav,
 * Jobs workspace, and setup panel therefore subscribe to the same snapshot and
 * share an in-flight request.
 */
const DEFAULT_ONLINE_WINDOW_MS = 90_000;
const OFFLINE_POLL_MS = 5_000;
const ONLINE_POLL_MS = 20_000;

export type RunnerPresence =
  | { status: "unknown" }
  | { status: "unavailable"; lastUsedAt: Date | null }
  | {
      status: "offline";
      lastUsedAt: Date | null;
      minutesAgo: number | null;
    }
  | {
      status: "online";
      lastUsedAt: Date;
      minutesAgo: number;
      secondsAgo: number;
      onlineWindowMs: number;
    };

export type RunnerPresenceView = RunnerPresence & {
  refresh: () => Promise<void>;
};

type PresenceResponse = {
  status?: "online" | "offline";
  lastUsedAt: string | null;
  checkedAt?: string;
  onlineWindowMs?: number;
};

let snapshot: RunnerPresence = { status: "unknown" };
let inFlight: Promise<void> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let activeConsumers = 0;
const listeners = new Set<(next: RunnerPresence) => void>();

function lastObservedAt(): Date | null {
  return "lastUsedAt" in snapshot ? snapshot.lastUsedAt : null;
}

function publish(next: RunnerPresence) {
  snapshot = next;
  listeners.forEach((listener) => listener(next));
}

function clearExpiryTimer() {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
}

function scheduleExpiry(
  lastUsedAt: Date,
  remainingMs: number,
  minutesAgoAtExpiry: number,
) {
  clearExpiryTimer();
  if (remainingMs <= 0) {
    publish({ status: "offline", lastUsedAt, minutesAgo: minutesAgoAtExpiry });
    return;
  }
  expiryTimer = setTimeout(() => {
    if (
      snapshot.status === "online" &&
      snapshot.lastUsedAt.getTime() === lastUsedAt.getTime()
    ) {
      publish({
        status: "offline",
        lastUsedAt,
        minutesAgo: minutesAgoAtExpiry,
      });
      if (activeConsumers > 0) schedulePoll();
    }
  }, remainingMs);
}

type ParsedPresence = {
  presence: RunnerPresence;
  expiresInMs: number | null;
  minutesAgoAtExpiry: number | null;
};

function parsePresence(json: PresenceResponse): ParsedPresence {
  if (!json.lastUsedAt) {
    return {
      presence: { status: "offline", lastUsedAt: null, minutesAgo: null },
      expiresInMs: null,
      minutesAgoAtExpiry: null,
    };
  }

  const lastUsedAt = new Date(json.lastUsedAt);
  if (Number.isNaN(lastUsedAt.getTime())) {
    throw new Error("Invalid Runner presence timestamp");
  }
  const onlineWindowMs =
    Number.isSafeInteger(json.onlineWindowMs) && Number(json.onlineWindowMs) > 0
      ? Number(json.onlineWindowMs)
      : DEFAULT_ONLINE_WINDOW_MS;
  const checkedAt = json.checkedAt ? new Date(json.checkedAt) : new Date();
  if (Number.isNaN(checkedAt.getTime())) {
    throw new Error("Invalid Runner presence check timestamp");
  }
  // Both timestamps come from the server. Their difference is immune to a
  // user's misconfigured device clock; only the relative expiry delay runs on
  // the browser clock.
  const ageMs = Math.max(0, checkedAt.getTime() - lastUsedAt.getTime());
  const online =
    json.status === "online" ||
    (json.status === undefined && ageMs <= onlineWindowMs);

  if (!online) {
    return {
      presence: {
        status: "offline",
        lastUsedAt,
        minutesAgo: Math.floor(ageMs / 60_000),
      },
      expiresInMs: null,
      minutesAgoAtExpiry: null,
    };
  }
  return {
    presence: {
      status: "online",
      lastUsedAt,
      minutesAgo: Math.floor(ageMs / 60_000),
      secondsAgo: Math.floor(ageMs / 1_000),
      onlineWindowMs,
    },
    expiresInMs: Math.max(0, onlineWindowMs - ageMs),
    minutesAgoAtExpiry: Math.floor(
      (ageMs + Math.max(0, onlineWindowMs - ageMs)) / 60_000,
    ),
  };
}

export function refreshRunnerPresence(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch("/api/agent/presence");
      if (!response.ok) throw new Error(`status=${response.status}`);
      const parsed = parsePresence((await response.json()) as PresenceResponse);
      const next = parsed.presence;
      publish(next);
      if (
        next.status === "online" &&
        parsed.expiresInMs !== null &&
        parsed.minutesAgoAtExpiry !== null
      ) {
        scheduleExpiry(
          next.lastUsedAt,
          parsed.expiresInMs,
          parsed.minutesAgoAtExpiry,
        );
      } else {
        clearExpiryTimer();
      }
    } catch {
      clearExpiryTimer();
      publish({ status: "unavailable", lastUsedAt: lastObservedAt() });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function pollDelay() {
  return snapshot.status === "online" ? ONLINE_POLL_MS : OFFLINE_POLL_MS;
}

function schedulePoll() {
  if (activeConsumers === 0 || typeof window === "undefined") return;
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    void refreshRunnerPresence().finally(schedulePoll);
  }, pollDelay());
}

function refreshOnFocus() {
  void refreshRunnerPresence().finally(schedulePoll);
}

function refreshOnVisibility() {
  if (document.visibilityState === "visible") refreshOnFocus();
}

function activatePolling() {
  activeConsumers += 1;
  if (activeConsumers === 1) {
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    void refreshRunnerPresence().finally(schedulePoll);
  }
  return () => {
    activeConsumers = Math.max(0, activeConsumers - 1);
    if (activeConsumers > 0) return;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    window.removeEventListener("focus", refreshOnFocus);
    document.removeEventListener("visibilitychange", refreshOnVisibility);
  };
}

function subscribe(listener: (next: RunnerPresence) => void) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearExpiryTimer();
      snapshot = { status: "unknown" };
    }
  };
}

export function useRunnerPresence(enabled: boolean): RunnerPresenceView {
  const [presence, setPresence] = useState<RunnerPresence>(snapshot);

  useEffect(() => subscribe(setPresence), []);
  useEffect(() => {
    if (!enabled) return;
    return activatePolling();
  }, [enabled]);

  const refresh = useCallback(() => refreshRunnerPresence(), []);
  return { ...presence, refresh } as RunnerPresenceView;
}
