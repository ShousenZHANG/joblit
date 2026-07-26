import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";
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

interface StoredSourceHealth {
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  lastReachableAt: Date | null;
  lastFailureAt: Date | null;
  reason: string | null;
}

type StoredSourceHealthRow = StoredSourceHealth & { source: string };

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function previousHealth(row: StoredSourceHealth | null): SourceHealth | null {
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

async function acquireSourceHealthLocks(
  tx: Prisma.TransactionClient,
  diagnostics: readonly SourceDiagnostic[],
): Promise<void> {
  const lockKeys = diagnostics.map((item) => stableInt32(item.source));
  // MATERIALIZED prevents PostgreSQL from moving the advisory lock call ahead
  // of the deterministic sort and introducing cross-run deadlocks.
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
}

async function readStoredSourceHealth(
  tx: Prisma.TransactionClient,
  diagnostics: readonly SourceDiagnostic[],
): Promise<Map<string, StoredSourceHealthRow>> {
  const rows = await tx.sourceHealth.findMany({
    where: { source: { in: diagnostics.map((item) => item.source) } },
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
  return new Map(rows.map((row) => [row.source, row]));
}

function nextSourceHealthData(
  existing: StoredSourceHealth | null,
  diagnostic: SourceDiagnostic,
  checkedAtIso: string,
) {
  const next = advanceSourceHealth(
    previousHealth(existing),
    observationFromDiagnostic(diagnostic, checkedAtIso),
  );
  return {
    status: toPersistedSourceHealthStatus(next.status),
    consecutiveFailures: next.consecutiveFailures,
    lastCheckedAt: next.lastCheckedAt ? new Date(next.lastCheckedAt) : null,
    lastReachableAt: next.lastReachableAt
      ? new Date(next.lastReachableAt)
      : null,
    lastFailureAt: next.lastFailureAt ? new Date(next.lastFailureAt) : null,
    reason: next.reason,
  };
}

async function persistSourceDiagnostic(
  tx: Prisma.TransactionClient,
  diagnostic: SourceDiagnostic,
  existing: StoredSourceHealthRow | null,
  checkedAt: Date,
): Promise<void> {
  // The lock serializes writers while checkedAt defines logical order.
  if (existing?.lastCheckedAt && existing.lastCheckedAt >= checkedAt) return;
  const data = nextSourceHealthData(
    existing,
    diagnostic,
    checkedAt.toISOString(),
  );
  await tx.sourceHealth.upsert({
    where: { source: diagnostic.source },
    create: { source: diagnostic.source, ...data },
    update: data,
  });
}

/** Persist one fetch run's per-source results in a single transaction. */
export async function persistSourceHealthDiagnostics(
  diagnostics: readonly SourceDiagnostic[],
  checkedAt: Date = new Date(),
): Promise<void> {
  if (!diagnostics.length) return;
  const ordered = [
    ...new Map(diagnostics.map((item) => [item.source, item])).values(),
  ].sort((left, right) => left.source.localeCompare(right.source));

  await prisma.$transaction(
    async (tx) => {
      await acquireSourceHealthLocks(tx, ordered);
      const existing = await readStoredSourceHealth(tx, ordered);
      for (const diagnostic of ordered) {
        await persistSourceDiagnostic(
          tx,
          diagnostic,
          existing.get(diagnostic.source) ?? null,
          checkedAt,
        );
      }
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}
