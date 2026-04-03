/** Base URL for Jobflow API. Configured via extension storage or defaults. */
export const DEFAULT_API_BASE = "https://jobflow.app";

/** Storage keys. */
export const STORAGE_KEYS = {
  AUTH_TOKEN: "authToken",
  TOKEN_EXPIRES_AT: "tokenExpiresAt",
  USER_ID: "userId",
  CACHED_PROFILE: "cachedProfile",
  PREFERENCES: "preferences",
  API_BASE: "apiBase",
} as const;

/** Profile cache TTL in milliseconds (30 minutes). */
export const PROFILE_CACHE_TTL = 30 * 60 * 1000;
