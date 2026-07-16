export const DEFAULT_HERMES_BASE = "http://127.0.0.1:8642";
export const DEFAULT_HERMES_PROFILE_NAME = "";
const HERMES_PROFILE_NAME_RE = /^joblit-[a-f0-9]{16,64}$/;

export function isHermesProfileName(value: unknown): value is string {
  return typeof value === "string" && HERMES_PROFILE_NAME_RE.test(value);
}

export class HermesBaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesBaseValidationError";
  }
}

const LOOPBACK_URL_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})\/?$/i;

export function normalizeHermesBase(value: unknown): string {
  if (typeof value !== "string") throw new HermesBaseValidationError("Hermes endpoint must be a string");
  const candidate = value.trim();
  const match = LOOPBACK_URL_RE.exec(candidate);
  if (!match) throw new HermesBaseValidationError("Use a root loopback HTTP endpoint with an explicit port");
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new HermesBaseValidationError("Hermes endpoint port is invalid");
  }
  const host = match[1].toLowerCase();
  return `http://${host}:${port}`;
}

export function hermesBasePermissionPattern(base: string): string {
  const normalized = normalizeHermesBase(base);
  const match = LOOPBACK_URL_RE.exec(normalized);
  if (!match) throw new HermesBaseValidationError("Hermes endpoint is invalid");
  return `http://${match[1].toLowerCase()}/*`;
}

export async function requestHermesBasePermission(base: string): Promise<boolean> {
  const permission = { origins: [hermesBasePermissionPattern(base)] };
  if (await chrome.permissions.contains(permission)) return true;
  return chrome.permissions.request(permission);
}
