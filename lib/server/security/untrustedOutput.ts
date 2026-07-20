import { isIP } from "node:net";

import { isPrivateOrReservedAddress } from "@/lib/server/net/safeFetch";

const BIDI_AND_FORMAT_CONTROLS =
  /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const C0_CONTROLS_EXCEPT_TEXT_WHITESPACE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const FORMULA_PREFIX = /^[\s]*[=+\-@]/;
const SENSITIVE_QUERY_KEY =
  /(?:api[-_]?key|access[-_]?token|auth|authorization|code|credential|jwt|password|secret|session|signature|token)/i;

function normalizeUntrustedText(value: string): string {
  return value
    .replace(C0_CONTROLS_EXCEPT_TEXT_WHITESPACE, "")
    .replace(BIDI_AND_FORMAT_CONTROLS, "")
    .replace(/\r\n?/g, "\n");
}

function markdownHref(rawHref: string): string | null {
  const href = rawHref.trim().replace(/^<|>$/g, "");
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    // Relative links can navigate inside the product; fragments are harmless.
    return /^(?:\/(?!\/)|#)[^\u0000-\u001f]*$/.test(href) ? href : null;
  }
}

/**
 * Preserve ordinary Markdown while neutralising active content, tracking
 * images, dangerous URL schemes, bidi spoofing, and raw HTML.
 */
export function sanitizeMarkdown(
  input: string | null | undefined,
  maxChars = 50_000,
): string {
  if (!input) return "";
  let out = normalizeUntrustedText(input).slice(0, Math.max(0, maxChars));

  out = out.replace(
    /(!?)\[([^\]\r\n]{0,500})\]\(([^)\r\n]{0,2048})\)/g,
    (_match, image: string, label: string, rawHref: string) => {
      if (image) return label;
      const href = markdownHref(rawHref);
      return href ? `[${label}](${href})` : label;
    },
  );

  // react-markdown does not render raw HTML by default, but escaping here also
  // protects alternate renderers, logs, exports, and future pipeline stages.
  return out.replaceAll("<", "&lt;").replaceAll(">", "&gt;").trim();
}

/** One safe, single-line TSV cell. Neutralises spreadsheet formula execution. */
export function escapeTsvCell(value: unknown): string {
  const text = normalizeUntrustedText(String(value ?? ""))
    .replace(/[\t\n]+/g, " ")
    .trim();
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export type PipelineUrlPolicy = {
  allowedHosts?: readonly string[];
  allowSubdomains?: boolean;
  stripQuery?: boolean;
};

/**
 * Safe URL for persistence, logs, CSV/TSV pipelines, or user navigation.
 * This is synchronous structural sanitation only; network calls must still use
 * `safeOutboundFetch`, which additionally verifies every DNS answer.
 */
export function sanitizePipelineUrl(
  input: string | null | undefined,
  policy: PipelineUrlPolicy = {},
): string | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(normalizeUntrustedText(input).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (isIP(hostname) && isPrivateOrReservedAddress(hostname)) return null;

  if (policy.allowedHosts) {
    const allowed = policy.allowedHosts.some((raw) => {
      const host = raw.toLowerCase().replace(/\.$/, "");
      return (
        hostname === host ||
        ((policy.allowSubdomains ?? false) &&
          hostname.endsWith(`.${host}`))
      );
    });
    if (!allowed) return null;
  }

  url.hash = "";
  if (policy.stripQuery) {
    url.search = "";
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
  }
  return url.href;
}
