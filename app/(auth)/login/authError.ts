export type LoginErrorKey =
  | "accessDeniedError"
  | "accountNotLinkedError"
  | "genericError";

export function getLoginErrorKey(error: string | null): LoginErrorKey | null {
  if (!error) return null;
  if (error === "AccessDenied") return "accessDeniedError";
  if (error === "OAuthAccountNotLinked") return "accountNotLinkedError";
  return "genericError";
}

export function getSafeCallbackUrl(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/jobs";
}
