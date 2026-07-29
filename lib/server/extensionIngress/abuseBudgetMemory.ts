import {
  type AbuseBudgetDecision,
  type AbuseBudgetPort,
  type NormalizedAbuseBudgetDebit,
  normalizeAbuseBudgetDebits,
} from "./abuseBudget";

interface MemoryEntry {
  readonly count: number;
  readonly resetAt: number;
}

export interface MemoryAbuseBudgetOptions {
  readonly now?: () => number;
}

interface PlannedMemoryDebit extends NormalizedAbuseBudgetDebit {
  readonly nextCount: number;
  readonly remaining: number;
  readonly resetAt: number;
  readonly exceeds: boolean;
}

function pruneExpiredEntries(
  entries: Map<string, MemoryEntry>,
  currentTime: number,
): void {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= currentTime) entries.delete(key);
  }
}

function planMemoryDebits(
  debits: readonly NormalizedAbuseBudgetDebit[],
  entries: ReadonlyMap<string, MemoryEntry>,
  currentTime: number,
): readonly PlannedMemoryDebit[] {
  return debits.map((debit) => {
    const active = entries.get(debit.key);
    const activeEntry =
      active && active.resetAt > currentTime ? active : undefined;
    const currentCount = activeEntry?.count ?? 0;
    const resetAt = activeEntry?.resetAt ?? currentTime + debit.windowMs;
    const nextCount = currentCount + debit.cost;
    return {
      ...debit,
      nextCount,
      remaining: Math.max(0, debit.limit - nextCount),
      resetAt,
      exceeds: nextCount > debit.limit,
    };
  });
}

function blockedDecision(
  planned: readonly PlannedMemoryDebit[],
  currentTime: number,
): AbuseBudgetDecision | null {
  const blocked = planned.filter((entry) => entry.exceeds);
  if (blocked.length === 0) return null;
  const resetAt = Math.max(...blocked.map((entry) => entry.resetAt));
  return {
    allowed: false,
    remaining: 0,
    resetAt,
    retryAfter: Math.max(1, Math.ceil((resetAt - currentTime) / 1_000)),
  };
}

function commitPlannedDebits(
  entries: Map<string, MemoryEntry>,
  planned: readonly PlannedMemoryDebit[],
): void {
  for (const entry of planned) {
    entries.set(entry.key, {
      count: entry.nextCount,
      resetAt: entry.resetAt,
    });
  }
}

function allowedDecision(
  planned: readonly PlannedMemoryDebit[],
): AbuseBudgetDecision {
  const tightest = planned.reduce((selected, entry) => {
    if (entry.remaining < selected.remaining) return entry;
    if (
      entry.remaining === selected.remaining &&
      entry.resetAt > selected.resetAt
    ) {
      return entry;
    }
    return selected;
  });
  return {
    allowed: true,
    remaining: tightest.remaining,
    resetAt: tightest.resetAt,
    retryAfter: 0,
  };
}

function createMemoryConsumer(
  entries: Map<string, MemoryEntry>,
  now: () => number,
): AbuseBudgetPort["consume"] {
  return async (debits) => {
    const normalized = normalizeAbuseBudgetDebits(debits);
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw new RangeError(
        "The abuse-budget clock must return a non-negative integer.",
      );
    }
    pruneExpiredEntries(entries, currentTime);
    const planned = planMemoryDebits(normalized, entries, currentTime);
    const blocked = blockedDecision(planned, currentTime);
    if (blocked) return blocked;
    commitPlannedDebits(entries, planned);
    return allowedDecision(planned);
  };
}

/**
 * Deterministic, isolate-local fixed-window adapter.
 *
 * There is deliberately no `await` between planning and committing the map
 * updates. JavaScript therefore executes each consume operation as one atomic
 * turn, including when callers launch N operations with `Promise.all`.
 */
export function createMemoryAbuseBudgetPort(
  options: MemoryAbuseBudgetOptions = {},
): AbuseBudgetPort {
  const entries = new Map<string, MemoryEntry>();
  const now = options.now ?? Date.now;
  return { consume: createMemoryConsumer(entries, now) };
}
