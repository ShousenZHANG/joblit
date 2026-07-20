export type SourceObservationKind =
  | "reachable"
  | "empty"
  | "slug_gone"
  | "network"
  | "timeout"
  | "rate_limited"
  | "invalid_payload";

export interface SourceHealthObservation {
  kind: SourceObservationKind;
  checkedAt: string;
  message?: string;
}

export type SourceHealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unhealthy";

export interface SourceHealth {
  status: SourceHealthStatus;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastReachableAt: string | null;
  lastFailureAt: string | null;
  reason: SourceObservationKind | null;
}

export type PersistedSourceHealthStatus =
  | "UNKNOWN"
  | "HEALTHY"
  | "DEGRADED"
  | "DOWN";

const RESET_KINDS = new Set<SourceObservationKind>(["reachable", "empty"]);

/**
 * career-ops-compatible failure count: reachable and legitimate empty results
 * reset the streak; tenant loss and transport failures increment it.
 */
export function computeConsecutiveFailures(
  observations: readonly Pick<SourceHealthObservation, "kind">[],
): number {
  let count = 0;
  for (const observation of observations) {
    count = RESET_KINDS.has(observation.kind) ? 0 : count + 1;
  }
  return count;
}

export function classifySourceFailure(error: unknown): SourceObservationKind {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  // DNS errors such as getaddrinfo ENOTFOUND contain "notfound" but do not
  // prove a tenant slug disappeared. Rediscovery is allowed only for an
  // explicit HTTP 404/410 or a structured slug-gone marker.
  if (
    /\bhttp(?: status)?\s+(?:404|410)\b|(?:^|\b)slug[ _-]?gone(?:\b|$)/.test(
      message,
    )
  ) {
    return "slug_gone";
  }
  if (/\b429\b|rate[ _-]?limit|too many requests/.test(message)) {
    return "rate_limited";
  }
  if (/abort|timeout|timed out/.test(message)) return "timeout";
  if (/expected (?:a |an )?.*(?:array|object)|invalid (?:json|payload)/.test(message)) {
    return "invalid_payload";
  }
  return "network";
}

export interface SourceHealthPolicy {
  degradedAfter?: number;
  unhealthyAfter?: number;
}

function thresholds(policy: SourceHealthPolicy): {
  degradedAfter: number;
  unhealthyAfter: number;
} {
  const normalizedThreshold = (
    value: number | undefined,
    fallback: number,
  ): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(1, Math.trunc(value))
      : fallback;
  const degradedAfter = normalizedThreshold(policy.degradedAfter, 1);
  return {
    degradedAfter,
    unhealthyAfter: Math.max(
      degradedAfter,
      normalizedThreshold(policy.unhealthyAfter, 3),
    ),
  };
}

export function observationFromDiagnostic(
  diagnostic: { ok: boolean; raw: number; error?: string },
  checkedAt: string,
): SourceHealthObservation {
  return {
    kind: diagnostic.ok
      ? diagnostic.raw > 0
        ? "reachable"
        : "empty"
      : classifySourceFailure(diagnostic.error ?? "source failure"),
    checkedAt,
    ...(diagnostic.error ? { message: diagnostic.error } : {}),
  };
}

/**
 * Advance one persisted source-health snapshot. No event history is required,
 * matching SourceHealth's compact DB shape.
 */
export function advanceSourceHealth(
  previous: SourceHealth | null,
  observation: SourceHealthObservation,
  policy: SourceHealthPolicy = {},
): SourceHealth {
  const { degradedAfter, unhealthyAfter } = thresholds(policy);
  const reset = RESET_KINDS.has(observation.kind);
  const consecutiveFailures = reset
    ? 0
    : (previous?.consecutiveFailures ?? 0) + 1;
  const status: SourceHealthStatus =
    consecutiveFailures >= unhealthyAfter
      ? "unhealthy"
      : consecutiveFailures >= degradedAfter
        ? "degraded"
        : "healthy";

  return {
    status,
    consecutiveFailures,
    lastCheckedAt: observation.checkedAt,
    lastReachableAt: reset
      ? observation.checkedAt
      : (previous?.lastReachableAt ?? null),
    lastFailureAt: reset
      ? (previous?.lastFailureAt ?? null)
      : observation.checkedAt,
    reason: observation.kind,
  };
}

/** Compute current status from oldest-to-newest observations. */
export function computeSourceHealth(
  observations: readonly SourceHealthObservation[],
  policy: SourceHealthPolicy = {},
): SourceHealth {
  let health: SourceHealth | null = null;
  for (const observation of observations) {
    health = advanceSourceHealth(health, observation, policy);
  }
  return (
    health ?? {
      status: "unknown",
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastReachableAt: null,
      lastFailureAt: null,
      reason: null,
    }
  );
}

export function toPersistedSourceHealthStatus(
  status: SourceHealthStatus,
): PersistedSourceHealthStatus {
  switch (status) {
    case "unknown":
      return "UNKNOWN";
    case "healthy":
      return "HEALTHY";
    case "degraded":
      return "DEGRADED";
    case "unhealthy":
      return "DOWN";
  }
}
