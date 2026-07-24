import type { ResumeImportOutput, CoverImportOutput } from "../types";
import {
  CoverGenerationOutputSchema,
  ResumeGenerationOutputSchema,
} from "@/lib/shared/schemas/applicationGenerationOutput";

function extractFirstJsonObject(value: string): string | null {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (start < 0) {
      if (char === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return null;
}

function parseCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return (
    actual.length === required.length &&
    actual.every((key, index) => key === required[index])
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function hasValidLegacySkillGroups(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    return false;
  }
  return value.every((item) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["label", "category", "items"])) {
      return false;
    }
    const label =
      typeof item.label === "string"
        ? item.label.trim()
        : typeof item.category === "string"
          ? item.category.trim()
          : "";
    return (
      label.length > 0 &&
      label.length <= 100 &&
      Array.isArray(item.items) &&
      item.items.length >= 1 &&
      item.items.length <= 40 &&
      item.items.every(
        (skill) =>
          typeof skill === "string" &&
          skill.trim().length > 0 &&
          skill.trim().length <= 120,
      )
    );
  });
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.trim().length <= maxLength)
  );
}

export function parseTailorOutput(
  raw: string,
  target: "resume" | "cover",
): ResumeImportOutput | CoverImportOutput | null {
  const source = raw.trim();
  if (!source) return null;

  let parsed = parseCandidate(source);
  if (!parsed) {
    const repaired = source
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u00A0/g, " ")
      .replace(/,\s*([}\]])/g, "$1");
    parsed = parseCandidate(repaired);
    if (!parsed) {
      const fenced = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
      if (fenced) parsed = parseCandidate(fenced.trim());
    }
    if (!parsed) {
      const firstObject = extractFirstJsonObject(repaired);
      if (firstObject) parsed = parseCandidate(firstObject);
    }
  }
  if (!isRecord(parsed)) return null;

  const obj = parsed;
  if (target === "resume") {
    const current = ResumeGenerationOutputSchema.safeParse(obj);
    if (current.success) return current.data;

    const cvSummary =
      typeof obj.cvSummary === "string" ? obj.cvSummary.trim() : "";
    if (
      !cvSummary ||
      cvSummary.length > 2000 ||
      !isRecord(obj.latestExperience)
    ) return null;

    const legacyBullets = obj.latestExperience.bullets;
    if (
      !hasOnlyKeys(obj, ["cvSummary", "latestExperience", "skillsFinal"]) ||
      !hasExactKeys(obj.latestExperience, ["bullets"]) ||
      !Array.isArray(legacyBullets) ||
      legacyBullets.length < 1 ||
      legacyBullets.length > 15 ||
      !legacyBullets.every(
        (item) =>
          typeof item === "string" &&
          item.trim().length > 0 &&
          item.trim().length <= 320,
      ) ||
      !hasValidLegacySkillGroups(obj.skillsFinal)
    ) {
      return null;
    }
    return {
      cvSummary,
      latestExperience: { addedBullets: [] },
    };
  }

  const current = CoverGenerationOutputSchema.safeParse(obj);
  if (current.success) return current.data;

  if (!hasExactKeys(obj, ["cover"]) || !isRecord(obj.cover)) return null;
  const coverRoot = obj.cover;
  if (!hasOnlyKeys(coverRoot, [
    "candidateTitle",
    "subject",
    "date",
    "salutation",
    "paragraphOne",
    "paragraphTwo",
    "paragraphThree",
    "closing",
    "signatureName",
  ])) {
    return null;
  }
  if (
    !isOptionalBoundedString(coverRoot.candidateTitle, 160) ||
    !isOptionalBoundedString(coverRoot.subject, 220) ||
    !isOptionalBoundedString(coverRoot.date, 80) ||
    !isOptionalBoundedString(coverRoot.salutation, 220) ||
    !isOptionalBoundedString(coverRoot.closing, 300) ||
    !isOptionalBoundedString(coverRoot.signatureName, 120)
  ) {
    return null;
  }
  const paragraphOne =
    typeof coverRoot.paragraphOne === "string"
      ? coverRoot.paragraphOne.trim()
      : "";
  const paragraphTwo =
    typeof coverRoot.paragraphTwo === "string"
      ? coverRoot.paragraphTwo.trim()
      : "";
  const paragraphThree =
    typeof coverRoot.paragraphThree === "string"
      ? coverRoot.paragraphThree.trim()
      : "";

  if (!paragraphOne || !paragraphTwo || !paragraphThree) return null;
  if (
    paragraphOne.length > 2000 ||
    paragraphTwo.length > 2000 ||
    paragraphThree.length > 2000
  ) return null;

  return {
    cover: {
      paragraphOne,
      paragraphTwo,
      paragraphThree,
    },
  };
}

export function filenameFromDisposition(disposition: string | null) {
  if (!disposition) return null;
  // Prefer RFC 5987 `filename*=UTF-8''<pct-encoded>` so non-ASCII (e.g. CJK)
  // names are preserved; fall back to the plain ASCII `filename=`.
  const extended = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // malformed percent-encoding — fall through to the plain filename
    }
  }
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}
