/**
 * Parsing and validation utilities for manual AI output import.
 * Extracted from manual-generate route to keep the handler focused on orchestration.
 */

import { z } from "zod";
import {
  CoverGenerationOutputSchema,
  ResumeGenerationOutputSchema,
} from "@/lib/server/ai/promptContract";
import type { SkillsSelection } from "@/lib/shared/schemas/applicationGenerationOutput";

// ── Zod Schemas ──

export const ManualGenerateSchema = z
  .object({
    jobId: z.string().uuid(),
    target: z.enum(["resume", "cover"]),
    modelOutput: z.string().min(1).max(80_000),
    promptMeta: z.record(z.string(), z.unknown()).optional(),
    // Only one source can post here now. Kept as a field rather than dropped
    // so an older client's body still validates instead of 400-ing on a key
    // the server simply no longer needs.
    source: z.literal("manual_import").default("manual_import"),
  })
  .strict();

export const ImportedPromptMetaSchema = z
  .object({
    ruleSetId: z.string().min(1),
    resumeSnapshotUpdatedAt: z.string().min(1),
    promptTemplateVersion: z.string().min(1).optional(),
    schemaVersion: z.string().min(1).optional(),
    skillPackVersion: z.string().min(1).optional(),
    promptHash: z.string().min(1).optional(),
  })
  .strict();

const ResumeStrictOutputSchema = ResumeGenerationOutputSchema;

const CoverLegacyContentSchema = z
  .object({
    candidateTitle: z.string().trim().max(160).optional(),
    subject: z.string().trim().max(220).optional(),
    date: z.string().trim().max(80).optional(),
    salutation: z.string().trim().max(220).optional(),
    paragraphOne: z.string().trim().min(1).max(2000),
    paragraphTwo: z.string().trim().min(1).max(2000),
    paragraphThree: z.string().trim().min(1).max(2000),
    closing: z.string().trim().max(300).optional(),
    signatureName: z.string().trim().max(120).optional(),
  })
  .strict()
  .transform(({ paragraphOne, paragraphTwo, paragraphThree }) => ({
    paragraphOne,
    paragraphTwo,
    paragraphThree,
  }));

const CoverManualOutputSchema = z.object({ cover: CoverLegacyContentSchema }).strict();
const CoverStrictOutputSchema = CoverGenerationOutputSchema;

type ResumeManualOutput = z.infer<typeof ResumeStrictOutputSchema>;
type CoverManualOutput = z.infer<typeof CoverManualOutputSchema>;

type ParsedOutput<T> = { data: T | null; issues: string[] };

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

function parseStrictJson<T>(raw: string, schema: z.ZodType<T>): ParsedOutput<T> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { data: null, issues: ["Payload must be one valid JSON object."] };
  }

  const parsed = schema.safeParse(candidate);
  return parsed.success
    ? { data: parsed.data, issues: [] }
    : { data: null, issues: zodIssues(parsed.error) };
}

export function parseResumeStrictOutput(raw: string): ParsedOutput<ResumeManualOutput> {
  return parseStrictJson(raw, ResumeStrictOutputSchema);
}

export function parseCoverStrictOutput(raw: string): ParsedOutput<CoverManualOutput> {
  return parseStrictJson(raw, CoverStrictOutputSchema);
}

// ── JSON Parsing ──

function parseJsonCandidate(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;

  const parse = (value: string): unknown | null => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const extractFirstJsonObject = (value: string): string | null => {
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
  };

  const direct = parse(text);
  if (direct) return direct;

  const repaired = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/ /g, " ")
    .replace(/,\s*([}\]])/g, "$1");

  const repairedDirect = parse(repaired);
  if (repairedDirect) return repairedDirect;

  const fencedBlock = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fencedBlock) {
    const fromFence = parse(fencedBlock.trim());
    if (fromFence) return fromFence;
  }

  const firstJsonObject = extractFirstJsonObject(repaired);
  if (firstJsonObject) {
    const parsedObject = parse(firstJsonObject);
    if (parsedObject) return parsedObject;
  }

  return null;
}

// ── Resume Output Parsing ──

function readIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
}

/**
 * Normalizes the dialects a chatbot produces for a skills selection into the
 * `{ group, items }` shape. Only index-shaped values survive: a payload that
 * names skills as strings loses them here rather than smuggling a skill the
 * candidate never wrote into the strict schema below.
 */
function normalizeSkillsSelection(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    const group = readIndex(
      record.group ?? record.groupIndex ?? record.group_index ?? record.category,
    );
    const rawItems = record.items ?? record.itemIndexes ?? record.item_indexes;
    const items = Array.isArray(rawItems)
      ? rawItems.map(readIndex).filter((index): index is number => index !== null)
      : undefined;
    return { group: group ?? undefined, items };
  });
}

export function parseResumeManualOutput(raw: string): {
  data: ResumeManualOutput | null;
  issues: string[];
} {
  const candidate = parseJsonCandidate(raw);
  if (!candidate || typeof candidate !== "object") {
    return { data: null, issues: ["Payload is not valid JSON object."] };
  }

  const record = candidate as Record<string, unknown>;
  const rawSelection =
    record.skillsSelection ?? record.skills_selection ?? record.skills;

  const payload: Record<string, unknown> = {
    cvSummary:
      typeof record.cvSummary === "string"
        ? record.cvSummary
        : typeof record.cv_summary === "string"
          ? record.cv_summary
          : typeof record.summary === "string"
            ? record.summary
            : "",
    skillsSelection: normalizeSkillsSelection(rawSelection),
  };

  const parsed = ResumeStrictOutputSchema.safeParse(payload);
  if (parsed.success) return { data: parsed.data, issues: [] };
  return {
    data: null,
    issues: zodIssues(parsed.error),
  };
}

// ── Skills Selection Bounds ──

export type SkillsSelectionBoundsFailure = {
  kind: "group_out_of_range" | "item_out_of_range";
  group: number;
  item?: number;
};

/**
 * Confirms every index in a selection addresses a skill the candidate actually
 * wrote. The generation schema bounds indexes structurally; only the profile
 * knows whether index 7 exists, so this runs at the import boundary with the
 * master profile in hand.
 *
 * This is the check that makes selection-by-reference safe: a model cannot name
 * a skill, and an index it invents addresses nothing and is rejected here.
 */
export function validateSkillsSelectionBounds(
  selection: SkillsSelection,
  masterSkills: readonly { items: readonly string[] }[],
): SkillsSelectionBoundsFailure | null {
  for (const entry of selection) {
    const group = masterSkills[entry.group];
    if (!group) {
      return { kind: "group_out_of_range", group: entry.group };
    }
    for (const item of entry.items) {
      if (!group.items[item]) {
        return { kind: "item_out_of_range", group: entry.group, item };
      }
    }
  }
  return null;
}

/** The candidate's skill groups, in the shape the bounds check needs. */
export function masterSkillGroups(
  profile: unknown,
): { category: string; items: string[] }[] {
  if (!profile || typeof profile !== "object") return [];
  const skills = (profile as Record<string, unknown>).skills;
  if (!Array.isArray(skills)) return [];
  return skills
    .map((group) => {
      if (!group || typeof group !== "object") return null;
      const record = group as Record<string, unknown>;
      const category =
        typeof record.category === "string"
          ? record.category
          : typeof record.label === "string"
            ? record.label
            : "";
      const items = Array.isArray(record.items)
        ? record.items.filter((item): item is string => typeof item === "string")
        : [];
      return { category, items };
    })
    .filter((group): group is { category: string; items: string[] } => group !== null);
}

// ── Cover Output Parsing ──

export function parseCoverManualOutput(raw: string): {
  data: CoverManualOutput | null;
  issues: string[];
} {
  const candidate = parseJsonCandidate(raw);
  if (!candidate || typeof candidate !== "object") {
    return { data: null, issues: ["Payload is not valid JSON object."] };
  }

  const record = candidate as Record<string, unknown>;
  const coverRecord =
    record.cover && typeof record.cover === "object" ? (record.cover as Record<string, unknown>) : record;

  const payload = {
    cover: {
      subject: typeof coverRecord.subject === "string" ? coverRecord.subject : undefined,
      candidateTitle:
        typeof coverRecord.candidateTitle === "string" ? coverRecord.candidateTitle : undefined,
      date: typeof coverRecord.date === "string" ? coverRecord.date : undefined,
      salutation: typeof coverRecord.salutation === "string" ? coverRecord.salutation : undefined,
      paragraphOne:
        typeof coverRecord.paragraphOne === "string"
          ? coverRecord.paragraphOne
          : typeof coverRecord.paragraph_1 === "string"
            ? coverRecord.paragraph_1
          : typeof coverRecord.p1 === "string"
            ? coverRecord.p1
            : "",
      paragraphTwo:
        typeof coverRecord.paragraphTwo === "string"
          ? coverRecord.paragraphTwo
          : typeof coverRecord.paragraph_2 === "string"
            ? coverRecord.paragraph_2
          : typeof coverRecord.p2 === "string"
            ? coverRecord.p2
            : "",
      paragraphThree:
        typeof coverRecord.paragraphThree === "string"
          ? coverRecord.paragraphThree
          : typeof coverRecord.paragraph_3 === "string"
            ? coverRecord.paragraph_3
          : typeof coverRecord.p3 === "string"
            ? coverRecord.p3
            : "",
      closing: typeof coverRecord.closing === "string" ? coverRecord.closing : undefined,
      signatureName:
        typeof coverRecord.signatureName === "string" ? coverRecord.signatureName : undefined,
    },
  };

  const parsed = CoverManualOutputSchema.safeParse(payload);
  if (parsed.success) return { data: parsed.data, issues: [] };
  return {
    data: null,
    issues: zodIssues(parsed.error),
  };
}
