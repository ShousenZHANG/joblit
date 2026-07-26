import { createHash } from "node:crypto";

const PRIVATE_EXECUTOR_ID_RE =
  /(?:^|[^A-Za-z0-9])run_[A-Za-z0-9_-]+/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function hashTailoringRunValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function tailoringRunIdForIssue(
  userId: string,
  issueKey: string,
): string {
  const hex = hashTailoringRunValue({ userId, issueKey }).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

export function assertSafeTailoringIdentity(value: string): void {
  if (PRIVATE_EXECUTOR_ID_RE.test(value)) {
    throw new Error("Private executor run identifiers must not be persisted");
  }
}
