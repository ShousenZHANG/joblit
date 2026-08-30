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

/**
 * Decides whether a pasted payload is importable, using the same schemas the
 * server validates against.
 *
 * The tolerance here is for how a chatbot wraps its answer \u2014 smart quotes, a
 * code fence, a sentence before the JSON \u2014 not for what the answer contains.
 * The server accepts a few key aliases on top of this; a paste this rejects and
 * the server would have taken costs the user one retry, while the reverse would
 * let them submit something the import boundary throws away.
 */
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
      .replace(/ /g, " ")
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const schema =
    target === "resume"
      ? ResumeGenerationOutputSchema
      : CoverGenerationOutputSchema;
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

