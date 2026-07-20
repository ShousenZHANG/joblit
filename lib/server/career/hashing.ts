import { createHash } from "node:crypto";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function normalize(value: unknown, seen: WeakSet<object>): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence JSON contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Evidence JSON contains a cycle");
    seen.add(value);
    const normalized = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Evidence JSON contains a non-plain object");
    }
    if (seen.has(value)) throw new TypeError("Evidence JSON contains a cycle");
    seen.add(value);
    const source = value as Record<string, unknown>;
    const normalized = Object.create(null) as Record<string, CanonicalJson>;
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      normalized[key] = normalize(item, seen);
    }
    seen.delete(value);
    return normalized;
  }
  throw new TypeError(`Evidence JSON contains unsupported ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet()));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function stableEvidenceId(
  userId: string,
  kind: string,
  hash: string,
): string {
  return `ev_${sha256(`${userId}\u0000${kind}\u0000${hash}`).slice(0, 32)}`;
}

export function stableClaimId(
  userId: string,
  applicationId: string,
  claimHash: string,
  evidenceSnapshotId: string,
): string {
  return `ce_${sha256(
    `${userId}\u0000${applicationId}\u0000${claimHash}\u0000${evidenceSnapshotId}`,
  ).slice(0, 32)}`;
}
