import type { DetectedField } from "@ext/shared/types";
import type { FlatProfile } from "../filler/formFiller";

/**
 * Generate a structural fingerprint for a form.
 * Same form structure → same signature, even across different pages.
 */
export function generateFormSignature(fields: DetectedField[]): string {
  const normalized = fields
    .map((f) => `${f.category}:${normalizeLabel(f.labelText)}:${f.inputType}`)
    .sort()
    .join("|");

  return hashString(normalized);
}

/** Normalize a label for consistent matching. */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
    .trim();
}

/**
 * Simple non-crypto hash (djb2) for fingerprinting.
 * Not for security — just for grouping similar forms.
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Score how similar two form signatures are (0-1). */
export function signatureSimilarity(sig1: string, sig2: string): number {
  return sig1 === sig2 ? 1.0 : 0.0;
}

/**
 * Match detected fields against historical submissions.
 * Returns a map of fieldSelector → previously submitted value.
 */
export interface HistoricalMatch {
  fieldSelector: string;
  value: string;
  source: "exact" | "same_ats_domain" | "same_ats" | "user_rule";
  confidence: number;
}

export interface SubmissionRecord {
  formSignature: string;
  pageDomain: string;
  atsProvider: string | null;
  fieldValues: Record<string, string>;
  fieldMappings: Record<string, { profilePath?: string; confidence: number }>;
}

export interface MappingRule {
  fieldSelector: string;
  fieldLabel: string | null;
  atsProvider: string | null;
  pageDomain: string | null;
  profilePath: string;
  staticValue: string | null;
  source: string;
  confidence: number;
  useCount: number;
}

/**
 * Find the best historical values for detected fields.
 * Priority: user rules > exact signature > same ATS+domain > same ATS.
 */
export function matchFieldsFromHistory(
  fields: DetectedField[],
  currentSignature: string,
  currentDomain: string,
  currentAts: string,
  submissions: SubmissionRecord[],
  rules: MappingRule[],
  profile?: FlatProfile | null,
): Map<string, HistoricalMatch> {
  const matches = new Map<string, HistoricalMatch>();

  // 1. User rules (highest priority)
  // Match by: exact selector → same label → same category
  for (const field of fields) {
    // Exact selector match (strongest)
    let rule = rules.find((r) => r.fieldSelector === field.selector);

    // Same label match
    if (!rule) {
      rule = rules.find(
        (r) =>
          r.fieldLabel &&
          normalizeLabel(r.fieldLabel) === normalizeLabel(field.labelText),
      );
    }

    // Same category match (cross-domain knowledge)
    if (!rule) {
      rule = rules.find(
        (r) => r.profilePath === field.category && r.source === "user",
      );
    }

    if (rule) {
      // Resolve value: staticValue takes priority, then profilePath lookup
      const profileValue = profile ? (profile as Record<string, string>)[rule.profilePath] : "";
      const value = rule.staticValue ?? profileValue ?? "";
      if (value) {
        matches.set(field.selector, {
          fieldSelector: field.selector,
          value,
          source: "user_rule",
          confidence: rule.confidence,
        });
      }
    }
  }

  // 2. Exact signature match
  const exactMatch = submissions.find((s) => s.formSignature === currentSignature);
  if (exactMatch) {
    for (const field of fields) {
      if (matches.has(field.selector)) continue;
      const key = field.name || field.id || field.selector;
      const value = exactMatch.fieldValues[key];
      if (value) {
        matches.set(field.selector, {
          fieldSelector: field.selector,
          value,
          source: "exact",
          confidence: 0.95,
        });
      }
    }
  }

  // 3. Same ATS + same domain
  const sameAtsDomain = submissions.filter(
    (s) =>
      s.formSignature !== currentSignature &&
      s.atsProvider === currentAts &&
      s.pageDomain === currentDomain,
  );
  for (const sub of sameAtsDomain) {
    for (const field of fields) {
      if (matches.has(field.selector)) continue;
      const key = field.name || field.id || field.selector;
      const value = sub.fieldValues[key];
      if (value) {
        matches.set(field.selector, {
          fieldSelector: field.selector,
          value,
          source: "same_ats_domain",
          confidence: 0.8,
        });
      }
    }
  }

  // 4. Same ATS (any domain)
  const sameAts = submissions.filter(
    (s) =>
      s.atsProvider === currentAts &&
      s.pageDomain !== currentDomain,
  );
  for (const sub of sameAts) {
    for (const field of fields) {
      if (matches.has(field.selector)) continue;
      const key = field.name || field.id || field.selector;
      const value = sub.fieldValues[key];
      if (value) {
        matches.set(field.selector, {
          fieldSelector: field.selector,
          value,
          source: "same_ats",
          confidence: 0.6,
        });
      }
    }
  }

  return matches;
}
