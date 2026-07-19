export type LoginErrorKey =
  | "accessDeniedError"
  | "accountNotLinkedError"
  | "genericError";

const CALLBACK_SENTINEL_ORIGIN = "https://joblit.invalid";
const DEFAULT_CALLBACK_URL = "/jobs";

export function getLoginErrorKey(error: string | null): LoginErrorKey | null {
  if (!error) return null;
  if (error === "AccessDenied") return "accessDeniedError";
  if (error === "OAuthAccountNotLinked") return "accountNotLinkedError";
  return "genericError";
}

export function getSafeCallbackUrl(value: string | null): string {
  if (!value?.startsWith("/")) return DEFAULT_CALLBACK_URL;

  try {
    const parsed = new URL(value, CALLBACK_SENTINEL_ORIGIN);
    if (parsed.origin !== CALLBACK_SENTINEL_ORIGIN) return DEFAULT_CALLBACK_URL;
    if (
      parsed.pathname === "/login" ||
      parsed.pathname.startsWith("/login/") ||
      parsed.pathname === "/api/auth" ||
      parsed.pathname.startsWith("/api/auth/")
    ) {
      return DEFAULT_CALLBACK_URL;
    }

    const candidate = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!candidate.startsWith("/") || candidate.startsWith("//")) {
      return DEFAULT_CALLBACK_URL;
    }

    const verified = new URL(candidate, CALLBACK_SENTINEL_ORIGIN);
    if (verified.origin !== CALLBACK_SENTINEL_ORIGIN) return DEFAULT_CALLBACK_URL;
    return candidate;
  } catch {
    return DEFAULT_CALLBACK_URL;
  }
}
