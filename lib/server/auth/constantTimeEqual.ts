import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for service secrets such as
 * FETCH_RUN_SECRET. Plain `===` short-circuits on the first
 * differing byte, leaking secret length/prefix to a timing attacker. This
 * compares in time independent of where the mismatch is.
 *
 * Returns false for any nullish/empty input so a missing header never matches
 * a missing secret.
 */
export function constantTimeEqual(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws if lengths differ; compare against a fixed-length
  // digest-style guard by length-checking first (length itself is not secret
  // for fixed-length tokens, and unequal length is always a non-match).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
