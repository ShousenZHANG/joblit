import {
  sanitizeMarkdown,
  sanitizePipelineUrl,
} from "@/lib/server/security/untrustedOutput";

// Field normalizers shared by the aggregator adapters. Each adapter still owns
// its own payload shape; only the value-level cleanup is common.

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Feeds hand back HTML fragments; the DB column stores plain text. */
export function stripHtml(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const plain = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? sanitizeMarkdown(plain) || null : null;
}

/**
 * Parse a feed timestamp to ISO-8601, or null when it is unusable.
 *
 * `assumeUtc` covers feeds that publish an otherwise-ISO string with no zone
 * designator. Reading those as local time would shift every listing date by
 * the server's offset, so the zone is appended explicitly.
 */
export function isoDate(value: unknown, assumeUtc = false): string | null {
  const raw = text(value);
  if (!raw) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  const candidate =
    assumeUtc && !hasZone ? `${raw.replace(" ", "T")}Z` : raw.replace(" ", "T");
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Only absolute https posting links are usable: they are persisted and later
 *  opened by the user, and they are the dedup key. */
export function httpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    return sanitizePipelineUrl(raw);
  } catch {
    return null;
  }
}

/** Render a min/max pair as the source-provided salary label. */
export function salaryRange(
  min: unknown,
  max: unknown,
  currency?: unknown,
): string | null {
  const lo = typeof min === "number" && min > 0 ? min : null;
  const hi = typeof max === "number" && max > 0 ? max : null;
  const unit = text(currency);
  const suffix = unit ? ` ${unit}` : "";
  if (lo && hi) return `${lo} - ${hi}${suffix}`;
  if (lo) return `${lo}+${suffix}`;
  if (hi) return `up to ${hi}${suffix}`;
  return null;
}
