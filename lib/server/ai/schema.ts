import {
  CoverGenerationOutputSchema,
  ResumeGenerationOutputSchema,
  type CoverGenerationOutput,
  type ResumeGenerationOutput,
} from "./promptContract";
import type { z } from "zod";

/**
 * Internal providers emit both independently versioned targets in one
 * transport payload. The target schemas remain the source of truth; this
 * combined object is only a provider-side batching envelope.
 */
const TailorModelOutputSchema = ResumeGenerationOutputSchema.extend({
  cover: CoverGenerationOutputSchema.shape.cover,
}).strict();

export type TailorModelOutput = ReturnType<
  typeof TailorModelOutputSchema.parse
>;

function repairJsonText(input: string) {
  let text = input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\uFEFF/g, "")
    .trim();

  text = text.replace(/,\s*([}\]])/g, "$1");
  text = text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");

  let result = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") continue;
      if (char === '"' && !escaped) inString = false;
      escaped = char === "\\" && !escaped;
      result += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      escaped = false;
    }
    result += char;
  }

  return result;
}

function parseCandidate<T>(value: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Parse the current internal-provider contract. This deliberately does not
 * accept the retired full-bullet-list or skills contract; only the manual
 * import adapter owns that compatibility window.
 */
function parseProviderOutput<T>(raw: string, schema: z.ZodType<T>): T | null {
  const text = raw.trim();
  const withoutFences = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  const candidates = [
    text,
    withoutFences,
    start >= 0 && end > start ? text.slice(start, end + 1) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const direct = parseCandidate(candidate, schema);
    if (direct) return direct;
    const repaired = parseCandidate(repairJsonText(candidate), schema);
    if (repaired) return repaired;
  }

  return null;
}

export function parseTailorModelOutput(raw: string): TailorModelOutput | null {
  return parseProviderOutput(raw, TailorModelOutputSchema);
}
