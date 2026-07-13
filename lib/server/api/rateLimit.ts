/**
 * Simple in-memory sliding-window rate limiter for serverless environments.
 *
 * Limits are per-key (typically IP or userId). Since Vercel runs multiple
 * isolates, each instance maintains its own window — this provides per-instance
 * protection. For distributed rate limiting, upgrade to @upstash/ratelimit.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/** Evict expired entries periodically to prevent memory leaks. */
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

interface RateLimitConfig {
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Window duration in seconds. */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given key.
 * Returns whether the request is allowed and headers to set.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  cleanup(now);

  const entry = store.get(key);
  const windowMs = config.windowSeconds * 1000;

  if (!entry || now >= entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt: now + windowMs };
  }

  entry.count++;

  if (entry.count > config.limit) {
    return { allowed: false, limit: config.limit, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, limit: config.limit, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Extract a rate-limit key from a request.
 * Uses X-Forwarded-For (Vercel sets this), falls back to a generic key.
 */
export function rateLimitKeyFromRequest(req: Request, prefix: string): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return `${prefix}:${ip}`;
}

/**
 * Build standard rate-limit headers for the response.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
