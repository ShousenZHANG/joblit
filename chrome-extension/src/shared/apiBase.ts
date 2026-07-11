import { DEFAULT_API_BASE } from "./constants";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class ApiBaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiBaseValidationError";
  }
}

/** Validate and normalize the base used for authenticated extension requests. */
export function normalizeApiBase(
  value: unknown,
  fallback = DEFAULT_API_BASE,
): string {
  if (value != null && typeof value !== "string") {
    throw new ApiBaseValidationError("API Base URL must be a string");
  }

  const raw = typeof value === "string" ? value.trim() : "";
  const candidate = raw || fallback.trim();
  const hasQueryDelimiter = candidate.includes("?");
  const hasFragmentDelimiter = candidate.includes("#");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ApiBaseValidationError("Enter a valid absolute API Base URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiBaseValidationError("API Base URL must use HTTPS");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ApiBaseValidationError(
      "API Base URL must use HTTPS outside local development",
    );
  }
  if (url.username || url.password) {
    throw new ApiBaseValidationError(
      "API Base URL must not contain credentials",
    );
  }
  if (hasQueryDelimiter) {
    throw new ApiBaseValidationError(
      "API Base URL must not contain a query string",
    );
  }
  if (hasFragmentDelimiter) {
    throw new ApiBaseValidationError(
      "API Base URL must not contain a fragment",
    );
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return pathname ? `${url.origin}${pathname}` : url.origin;
}

/** Return the exact Chrome host-permission pattern for a normalized API base. */
export function apiBasePermissionPattern(base: string): string {
  const normalized = normalizeApiBase(base);
  const url = new URL(normalized);
  // Chrome host match patterns do not accept a port; an omitted port matches
  // all ports for that exact scheme + host.
  return `${url.protocol}//${url.hostname}/*`;
}

/** Treat persisted extension storage as untrusted legacy input. */
export function resolveStoredApiBase(value: unknown): string {
  try {
    return normalizeApiBase(value);
  } catch {
    return normalizeApiBase(DEFAULT_API_BASE);
  }
}

/** Ensure the exact API origin is granted from an explicit user gesture. */
export async function requestApiBasePermission(base: string): Promise<boolean> {
  const normalized = normalizeApiBase(base);
  const permissions = { origins: [apiBasePermissionPattern(normalized)] };
  if (await chrome.permissions.contains(permissions)) return true;
  return chrome.permissions.request(permissions);
}
