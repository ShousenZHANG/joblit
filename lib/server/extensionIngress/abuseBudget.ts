/**
 * One fixed-window budget that must be consumed as part of an atomic decision.
 *
 * Keys are storage identifiers, not raw credentials or network identifiers.
 * Callers are responsible for passing an opaque fingerprint rather than an IP
 * address, token, email address, or other user-controlled value.
 */
export interface AbuseBudgetDebit {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly cost?: number;
}

/**
 * The conservative aggregate of every debit in one atomic operation.
 *
 * `resetAt` is an epoch timestamp in milliseconds. `retryAfter` is expressed
 * in whole seconds and is zero when the operation was allowed.
 */
export interface AbuseBudgetDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfter: number;
}

export interface AbuseBudgetPort {
  consume(
    debits: readonly AbuseBudgetDebit[],
  ): Promise<AbuseBudgetDecision>;
}

/**
 * A storage/infrastructure failure, distinct from an exhausted budget.
 *
 * The HTTP ingress layer can report this privately and apply its documented
 * fail-open/fail-closed policy without mistaking an outage for a 429.
 */
export class AbuseBudgetUnavailableError extends Error {
  readonly code = "ABUSE_BUDGET_UNAVAILABLE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AbuseBudgetUnavailableError";
  }
}

export interface NormalizedAbuseBudgetDebit {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly cost: number;
}

/**
 * Validate once at the port boundary so every adapter has identical semantics.
 */
export function normalizeAbuseBudgetDebits(
  debits: readonly AbuseBudgetDebit[],
): readonly NormalizedAbuseBudgetDebit[] {
  if (debits.length === 0) {
    throw new RangeError("At least one abuse-budget debit is required.");
  }

  const seenKeys = new Set<string>();

  return debits.map((debit) => {
    const key = debit.key.trim();
    if (key.length === 0 || key.length > 512) {
      throw new RangeError(
        "An abuse-budget key must contain between 1 and 512 characters.",
      );
    }
    if (seenKeys.has(key)) {
      throw new RangeError(`Duplicate abuse-budget key: ${key}`);
    }
    seenKeys.add(key);

    const cost = debit.cost ?? 1;
    if (!Number.isSafeInteger(debit.limit) || debit.limit < 1) {
      throw new RangeError("An abuse-budget limit must be a positive integer.");
    }
    if (!Number.isSafeInteger(debit.windowMs) || debit.windowMs < 1) {
      throw new RangeError(
        "An abuse-budget window must be a positive integer in milliseconds.",
      );
    }
    if (
      !Number.isSafeInteger(cost) ||
      cost < 1 ||
      cost > debit.limit
    ) {
      throw new RangeError(
        "An abuse-budget cost must be a positive integer within its limit.",
      );
    }

    return {
      key,
      limit: debit.limit,
      windowMs: debit.windowMs,
      cost,
    };
  });
}
