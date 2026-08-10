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
const CONNECTION_CHECK_INTERVAL_MS = 1_000;
const CONNECTION_CHECK_WINDOW_MS = 15_000;

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
      /** Credential whose authenticated activity produced this observation. */
      credentialId: string | null;
      lastUsedAt: Date;
      minutesAgo: number;
      secondsAgo: number;
      onlineWindowMs: number;
      /** The Runner was recently online, but the latest presence read failed. */
      checkDelayed: boolean;
    };

export type RunnerPresenceView = RunnerPresence & {
  refresh: () => Promise<void>;
};

type PresenceResponse = {
  status?: "online" | "offline";
  credentialId?: string | null;
  lastUsedAt: string | null;
  checkedAt?: string;
  onlineWindowMs?: number;
};

let snapshot: RunnerPresence = { status: "unknown" };
let credentialScope: string | null = null;
let scopeVersion = 0;
let inFlight: { scopeVersion: number; promise: Promise<void> } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let connectionCheckTimer: ReturnType<typeof setTimeout> | null = null;
let connectionCheckUntil = 0;
let connectionCheckCredentialId: string | null = null;
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

function parsePresence(
  json: PresenceResponse,
  expectedCredentialId: string | null,
): ParsedPresence {
  // A scoped replacement check is satisfied only by authenticated activity
  // from that exact credential. Treat stale caches or incompatible responses
  // as offline instead of borrowing an older Runner's green state.
  if (
    expectedCredentialId !== null &&
    json.credentialId !== expectedCredentialId
  ) {
    return {
      presence: { status: "offline", lastUsedAt: null, minutesAgo: null },
      expiresInMs: null,
      minutesAgoAtExpiry: null,
    };
  }

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
      credentialId: json.credentialId ?? null,
      lastUsedAt,
      minutesAgo: Math.floor(ageMs / 60_000),
      secondsAgo: Math.floor(ageMs / 1_000),
      onlineWindowMs,
      checkDelayed: false,
    },
    expiresInMs: Math.max(0, onlineWindowMs - ageMs),
    minutesAgoAtExpiry: Math.floor(
      (ageMs + Math.max(0, onlineWindowMs - ageMs)) / 60_000,
    ),
  };
}

function presenceEndpoint(credentialId: string | null): string {
  if (!credentialId) return "/api/agent/presence";
  return `/api/agent/presence?credentialId=${encodeURIComponent(credentialId)}`;
}

function bindCredentialScope(credentialId: string): void {
  if (credentialScope === credentialId) return;
  credentialScope = credentialId;
  scopeVersion += 1;
  clearExpiryTimer();
  // Invalidating synchronously prevents one render where the newly displayed
  // command inherits an old Runner's online snapshot.
  publish({ status: "offline", lastUsedAt: null, minutesAgo: null });
}

export function refreshRunnerPresence(): Promise<void> {
  const requestScopeVersion = scopeVersion;
  const requestCredentialId = credentialScope;
  if (inFlight?.scopeVersion === requestScopeVersion) return inFlight.promise;

  const operation = (async () => {
    try {
      const response = await fetch(presenceEndpoint(requestCredentialId));
      if (!response.ok) throw new Error(`status=${response.status}`);
      const parsed = parsePresence(
        (await response.json()) as PresenceResponse,
        requestCredentialId,
      );
      if (requestScopeVersion !== scopeVersion) return;
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
      if (requestScopeVersion !== scopeVersion) return;
      // A transient presence endpoint failure is not evidence that a Runner
      // which was just observed online has disconnected. Preserve that
      // observation until its original server-derived TTL expires, while
      // exposing that the follow-up check was delayed.
      if (snapshot.status === "online") {
        publish({ ...snapshot, checkDelayed: true });
      } else {
        clearExpiryTimer();
        publish({ status: "unavailable", lastUsedAt: lastObservedAt() });
      }
    } finally {
      if (inFlight?.scopeVersion === requestScopeVersion) inFlight = null;
    }
  })();

  inFlight = { scopeVersion: requestScopeVersion, promise: operation };
  return operation;
}

/**
 * Make one issued credential the active presence identity and immediately
 * re-read it. This carries no raw token and is safe to call repeatedly.
 */
export function refreshRunnerPresenceForCredential(
  credentialId: string,
): Promise<void> {
  bindCredentialScope(credentialId);
  return refreshRunnerPresence();
}

function pollDelay() {
  return snapshot.status === "online" && !snapshot.checkDelayed
    ? ONLINE_POLL_MS
    : OFFLINE_POLL_MS;
}

function schedulePoll() {
  if (activeConsumers === 0 || typeof window === "undefined") return;
  if (connectionCheckUntil > Date.now()) return;
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    void refreshRunnerPresence().finally(schedulePoll);
  }, pollDelay());
}

function finishConnectionCheck(resumePolling: boolean) {
  if (connectionCheckTimer !== null) clearTimeout(connectionCheckTimer);
  connectionCheckTimer = null;
  connectionCheckUntil = 0;
  connectionCheckCredentialId = null;
  if (resumePolling && activeConsumers > 0) schedulePoll();
}

function scheduleConnectionCheck() {
  const freshOnline =
    snapshot.status === "online" &&
    !snapshot.checkDelayed &&
    (connectionCheckCredentialId === null ||
      snapshot.credentialId === connectionCheckCredentialId);
  if (
    activeConsumers === 0 ||
    typeof window === "undefined" ||
    freshOnline ||
    Date.now() >= connectionCheckUntil
  ) {
    finishConnectionCheck(activeConsumers > 0);
    return;
  }

  if (connectionCheckTimer !== null) clearTimeout(connectionCheckTimer);
  connectionCheckTimer = setTimeout(() => {
    connectionCheckTimer = null;
    if (Date.now() >= connectionCheckUntil) {
      finishConnectionCheck(true);
      return;
    }
    void refreshRunnerPresence().finally(scheduleConnectionCheck);
  }, CONNECTION_CHECK_INTERVAL_MS);
}

/**
 * Start one shared, short-lived fast check after the user copies a Runner
 * command. Repeated callers extend the same burst instead of creating parallel
 * timers or requests; the module-level in-flight guard also deduplicates the
 * immediate read.
 */
export function beginRunnerConnectionCheck(
  credentialId?: string,
): Promise<void> {
  if (credentialId) bindCredentialScope(credentialId);
  connectionCheckCredentialId = credentialId ?? credentialScope;
  connectionCheckUntil = Date.now() + CONNECTION_CHECK_WINDOW_MS;
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  if (connectionCheckTimer !== null) clearTimeout(connectionCheckTimer);
  connectionCheckTimer = null;
  return refreshRunnerPresence().finally(scheduleConnectionCheck);
}

/** Stop the fast setup burst while leaving ordinary shared presence polling. */
export function cancelRunnerConnectionCheck(): void {
  finishConnectionCheck(true);
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
    finishConnectionCheck(false);
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
      credentialScope = null;
      scopeVersion += 1;
      inFlight = null;
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
