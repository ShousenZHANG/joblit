// Pure helpers for the video cache layer. Kept separate from the Prisma-
// backed repository so they can be unit-tested without pulling in the
// database client (which requires DATABASE_URL at import time).

/**
 * Fresh = not yet expired. Boundary equality counts as expired so the
 * fallover point is deterministic at the exact TTL tick.
 */
export function isFresh(entry: { expiresAt: Date }, nowMs: number): boolean {
  return entry.expiresAt.getTime() > nowMs;
}

/**
 * YouTube Data API returns HTTP 403 plus a reason of "quotaExceeded",
 * "rateLimitExceeded", or "dailyLimitExceeded" when the daily 10k-unit
 * quota is drained. Anything else (network errors, parse errors, 5xx
 * from Google) short-circuits to false so the route still surfaces a
 * "real" error rather than silently serving stale data.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as {
    status?: number;
    code?: number | string;
    reason?: string;
    message?: string;
  };
  const numericStatus =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.code === "number"
        ? candidate.code
        : undefined;
  if (numericStatus === 403) return true;
  const reason = (candidate.reason ?? "").toLowerCase();
  if (
    reason === "quotaexceeded" ||
    reason === "ratelimitexceeded" ||
    reason === "dailylimitexceeded"
  ) {
    return true;
  }
  const message = (candidate.message ?? "").toLowerCase();
  return (
    message.includes("quotaexceeded") ||
    message.includes("quota exceeded") ||
    message.includes("dailylimitexceeded")
  );
}

/**
 * Stable cache-key builder shared by cache readers and writers. Keeping this
 * in one tiny pure helper prevents drift.
 */
export function buildCacheKey(
  category: string,
  timeWindow: string,
  sort = "trending",
): string {
  const base = `videos:${category}:${timeWindow}`;
  return sort === "trending" ? base : `${base}:${sort}`;
}
