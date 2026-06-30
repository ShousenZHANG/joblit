import type { ResumeImportOutput, CoverImportOutput } from "../types";

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
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (target === "resume") {
    const cvSummary =
      typeof obj.cvSummary === "string"
        ? obj.cvSummary.trim()
        : typeof obj.summary === "string"
          ? obj.summary.trim()
          : "";
    const latestExperience =
      obj.latestExperience && typeof obj.latestExperience === "object"
        ? (obj.latestExperience as Record<string, unknown>)
        : null;
    const bullets =
      latestExperience && Array.isArray(latestExperience.bullets)
        ? latestExperience.bullets.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];
    if (!cvSummary || bullets.length === 0) return null;
    return { cvSummary };
  }

  const coverRoot =
    obj.cover && typeof obj.cover === "object"
      ? (obj.cover as Record<string, unknown>)
      : obj;
  const paragraphOne =
    typeof coverRoot.paragraphOne === "string"
      ? coverRoot.paragraphOne.trim()
      : typeof coverRoot.p1 === "string"
        ? coverRoot.p1.trim()
        : "";
  const paragraphTwo =
    typeof coverRoot.paragraphTwo === "string"
      ? coverRoot.paragraphTwo.trim()
      : typeof coverRoot.p2 === "string"
        ? coverRoot.p2.trim()
        : "";
  const paragraphThree =
    typeof coverRoot.paragraphThree === "string"
      ? coverRoot.paragraphThree.trim()
      : typeof coverRoot.p3 === "string"
        ? coverRoot.p3.trim()
        : "";

  if (!paragraphOne || !paragraphTwo || !paragraphThree) return null;

  return {
    cover: {
      subject: typeof coverRoot.subject === "string" ? coverRoot.subject.trim() : undefined,
      date: typeof coverRoot.date === "string" ? coverRoot.date.trim() : undefined,
      salutation:
        typeof coverRoot.salutation === "string" ? coverRoot.salutation.trim() : undefined,
      paragraphOne,
      paragraphTwo,
      paragraphThree,
      closing: typeof coverRoot.closing === "string" ? coverRoot.closing.trim() : undefined,
      signatureName:
        typeof coverRoot.signatureName === "string"
          ? coverRoot.signatureName.trim()
          : undefined,
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
