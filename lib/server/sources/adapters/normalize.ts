import {
  sanitizeMarkdown,
  sanitizePipelineUrl,
} from "@/lib/server/security/untrustedOutput";

// Field normalizers shared by the aggregator adapters. Each adapter still owns
// its own payload shape; only the value-level cleanup is common.

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  cent: "¢",
  copy: "©",
  divide: "÷",
  emsp: "\u2003",
  ensp: "\u2002",
  euro: "€",
  ge: "≥",
  geq: "≥",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  le: "≤",
  leq: "≤",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: "\u00a0",
  ndash: "–",
  plus: "+",
  plusmn: "±",
  pound: "£",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  thinsp: "\u2009",
  times: "×",
  trade: "™",
  yen: "¥",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+);?|#x([\da-f]+);?|([a-z][\da-z]+);?)/gi,
    (
      match,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal || hexadecimal) {
        const codePoint = Number.parseInt(
          decimal ?? hexadecimal ?? "",
          decimal ? 10 : 16,
        );
        if (
          Number.isFinite(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }
        return match;
      }
      return HTML_ENTITIES[named?.toLocaleLowerCase("en") ?? ""] ?? match;
    },
  );
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "main",
  "p",
  "section",
]);
const CONTAINER_TAGS = new Set([
  "ol",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "ul",
]);

function replaceHtmlTagsWithStructure(value: string): string {
  let output = "";
  let cursor = 0;
  let unitDepth = 0;
  let rowCellCount = 0;

  for (const match of value.matchAll(/<[^>]*>/g)) {
    const index = match.index;
    const textBetweenTags = value.slice(cursor, index);
    if (/\S/u.test(textBetweenTags)) {
      output += textBetweenTags;
    } else if (textBetweenTags && output && !/\s$/u.test(output)) {
      output += " ";
    }
    cursor = index + match[0].length;

    if (/^<!/u.test(match[0])) continue;
    const tag = match[0].match(
      /^<\s*(\/?)\s*([a-z][\w:-]*)\b[^>]*?(\/?)\s*>$/iu,
    );
    if (!tag) {
      output += match[0];
      continue;
    }

    const closing = tag[1] === "/";
    const name = tag[2].toLocaleLowerCase("en");
    if (closing) {
      if (name === "li" || name === "td" || name === "th") {
        unitDepth = Math.max(0, unitDepth - 1);
      } else if (name === "tr") {
        rowCellCount = 0;
      } else if (BLOCK_TAGS.has(name) || CONTAINER_TAGS.has(name)) {
        output += unitDepth > 0 ? " " : "\n\n";
      }
      continue;
    }

    if (name === "br") {
      output += unitDepth > 0 ? " " : "\n";
    } else if (name === "li") {
      output += unitDepth > 0 ? "; " : "\n- ";
      unitDepth += 1;
    } else if (name === "tr") {
      output += "\n";
      rowCellCount = 0;
    } else if (name === "td" || name === "th") {
      if (rowCellCount > 0) output += " | ";
      rowCellCount += 1;
      unitDepth += 1;
    } else if (BLOCK_TAGS.has(name) || CONTAINER_TAGS.has(name)) {
      output += unitDepth > 0 ? " " : "\n\n";
    }

    if (tag[3] === "/" && (name === "li" || name === "td" || name === "th")) {
      unitDepth = Math.max(0, unitDepth - 1);
    }
  }

  return output + value.slice(cursor);
}

function htmlToStructuredText(value: string): string {
  const withoutInactiveContent = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "\n",
    );

  return decodeHtmlEntities(
    replaceHtmlTagsWithStructure(withoutInactiveContent),
  )
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Feeds hand back HTML fragments; the DB column stores safe structured text.
 * Block boundaries remain visible so downstream requirement analysis does not
 * have to infer headings and list membership from one flattened sentence.
 */
export function stripHtml(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const plain = htmlToStructuredText(raw);
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
