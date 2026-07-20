import { prisma } from "@/lib/server/prisma";
import {
  advanceSourceHealth,
  observationFromDiagnostic,
  toPersistedSourceHealthStatus,
  type SourceHealth,
  type SourceObservationKind,
} from "./sourceHealth";
import type { SourceDiagnostic } from "./runSourceFetch";

const SOURCE_HEALTH_LOCK_NAMESPACE = 0x53485243; // "SHRC"
const OBSERVATION_KINDS = new Set<SourceObservationKind>([
  "reachable",
  "empty",
  "slug_gone",
  "network",
  "timeout",
  "rate_limited",
  "invalid_payload",
]);

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function previousHealth(row: {
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  lastReachableAt: Date | null;
  lastFailureAt: Date | null;
  reason: string | null;
} | null): SourceHealth | null {
  if (!row) return null;
  const status =
    row.status === "HEALTHY"
      ? "healthy"
      : row.status === "DEGRADED"
        ? "degraded"
        : row.status === "DOWN"
          ? "unhealthy"
          : "unknown";
  return {
    status,
    consecutiveFailures: row.consecutiveFailures,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastReachableAt: row.lastReachableAt?.toISOString() ?? null,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    reason:
      row.reason && OBSERVATION_KINDS.has(row.reason as SourceObservationKind)
        ? (row.reason as SourceObservationKind)
        : null,
  };
}

/** Persist one fetch run's per-source results in a single transaction. */
export async function persistSourceHealthDiagnostics(
  diagnostics: readonly SourceDiagnostic[],
  checkedAt: Date = new Date(),
): Promise<void> {
  if (!diagnostics.length) return;
  const checkedAtIso = checkedAt.toISOString();
  const ordered = [
    ...new Map(diagnostics.map((item) => [item.source, item])).values(),
  ].sort((left, right) => left.source.localeCompare(right.source));

  await prisma.$transaction(async (tx) => {
    const lockKeys = ordered.map((diagnostic) =>
      stableInt32(diagnostic.source),
    );
    // Acquire all per-source locks in a deterministic order with one DB
    // roundtrip. MATERIALIZED prevents the planner from moving the advisory
    // lock call ahead of the sort and introducing cross-run deadlocks.
    await tx.$executeRaw`
      WITH ordered_locks AS MATERIALIZED (
        SELECT value::integer AS lock_key
        FROM jsonb_array_elements_text(
          ${JSON.stringify(lockKeys)}::jsonb
        ) AS values(value)
        ORDER BY value::integer
      )
      SELECT pg_advisory_xact_lock(
        ${SOURCE_HEALTH_LOCK_NAMESPACE}::integer,
        lock_key
      )
      FROM ordered_locks
    `;
    const existingRows = await tx.sourceHealth.findMany({
      where: { source: { in: ordered.map((item) => item.source) } },
      select: {
        source: true,
        status: true,
        consecutiveFailures: true,
        lastCheckedAt: true,
        lastReachableAt: true,
        lastFailureAt: true,
        reason: true,
      },
    });
    const existingBySource = new Map(
      existingRows.map((row) => [row.source, row]),
    );

    for (const diagnostic of ordered) {
      const next = advanceSourceHealth(
        previousHealth(existingBySource.get(diagnostic.source) ?? null),
        observationFromDiagnostic(diagnostic, checkedAtIso),
      );
      const data = {
        status: toPersistedSourceHealthStatus(next.status),
        consecutiveFailures: next.consecutiveFailures,
        lastCheckedAt: next.lastCheckedAt
          ? new Date(next.lastCheckedAt)
          : null,
        lastReachableAt: next.lastReachableAt
          ? new Date(next.lastReachableAt)
          : null,
        lastFailureAt: next.lastFailureAt
          ? new Date(next.lastFailureAt)
          : null,
        reason: next.reason,
      };
      await tx.sourceHealth.upsert({
        where: { source: diagnostic.source },
        create: { source: diagnostic.source, ...data },
        update: data,
      });
    }
  }, { maxWait: 5_000, timeout: 30_000 });
}
