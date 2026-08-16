import { z } from "zod";
import { SkillsSelectionSchema } from "./applicationGenerationOutput";

/**
 * Versioned snapshot of every AI proposal made for an Application,
 * paired with the user's accept/reject/edit decisions. Persisted on
 * Application.aiContent (JSON column).
 *
 * See ADR-0001 for the rationale (persistence vs diff-time recompute).
 *
 * SCHEMA VERSIONING:
 * Bump AI_CONTENT_SCHEMA_VERSION whenever the JSON shape changes in a
 * non-additive way. Older rows are upgraded on read by `upgradeLegacyAiContent`
 * below; readers reject unknown versions explicitly.
 */
export const AI_CONTENT_SCHEMA_VERSION = 2;

const aiImportSourceSchema = z.enum([
  "manual_import",
  "local_ai",
  "codex_batch",
]);
const aiGenerationSourceSchema = z.enum([
  "manual_import",
  "local_ai",
  "codex_batch",
  "server_batch",
]);

export const aiGenerationProvenanceSchema = z
  .object({
    generatedAt: z.string().datetime(),
    promptMetaHash: z.string(),
    source: aiGenerationSourceSchema,
  })
  .strict();

const aiTargetProvenanceSchema = z
  .object({
    resume: aiGenerationProvenanceSchema.optional(),
    cover: aiGenerationProvenanceSchema.optional(),
  })
  .strict();

const summarySchema = z
  .object({
    aiText: z.string(),
    originalText: z.string(),
    userEdit: z.string().optional(),
    accepted: z.boolean().default(true),
  })
  .strict();

/**
 * The tailored skills section: what the model selected, plus the user's
 * override when they have reordered or unticked something in the review panel.
 *
 * Same shape as the summary's `aiText`/`userEdit` pair, and for the same
 * reason — the AI proposal must survive an edit so Discard can restore it.
 * `accepted` has no meaning here: a skills section is a replacement of required
 * content, not an addition, so the user narrows the selection rather than
 * rejecting it wholesale (CONTEXT.md → AI Content).
 *
 * Both halves are index references into `ResumeProfile.skills`. Nothing on this
 * row is a skill name, so no edit — by the model or by a forged request body —
 * can introduce a skill the candidate did not write themselves.
 */
const skillsSelectionSchema = z
  .object({
    aiSelection: SkillsSelectionSchema,
    userSelection: SkillsSelectionSchema.optional(),
  })
  .strict();

/**
 * `skillsAdditions` (the AI's proposed new CV skill groups) and
 * `latestExperience` (AI-added experience bullets) were both retired: the model
 * kept proposing content the candidate had no evidence for, and the grounding
 * gate blocked finalize on almost every draft that carried it. Tailoring now
 * changes the summary and the skills *order* only.
 *
 * Rows written before the removal still carry those keys, and every other field
 * here stays `.strict()` on purpose — an unknown key is a signal that a client
 * is smuggling server-owned state. Rather than loosen that guarantee for the
 * whole object, drop the retired keys before validation so an old row (or a
 * browser tab loaded before the deploy) still reads back cleanly instead of
 * failing with AI_CONTENT_INVALID. No data migration is required; the keys
 * disappear on the next write.
 */
const RETIRED_CV_KEYS = ["skillsAdditions", "latestExperience"] as const;

const cvSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!RETIRED_CV_KEYS.some((key) => key in record)) return value;
  const next = { ...record };
  for (const key of RETIRED_CV_KEYS) delete next[key];
  return next;
}, z
  .object({
    summary: summarySchema,
    /**
     * Absent on rows written before tailoring selected skills. An absent
     * selection means "render the master profile's skills as they are", which
     * is exactly what those rows produced, so a legacy draft keeps rendering
     * the document it already rendered.
     */
    skillsSelection: skillsSelectionSchema.optional(),
  })
  .strict());

const coverParagraphSchema = z
  .object({
    aiText: z.string(),
    userEdit: z.string().optional(),
    accepted: z.boolean(),
  })
  .strict();

const coverSchema = z
  .object({
    paragraphOne: coverParagraphSchema,
    paragraphTwo: coverParagraphSchema,
    paragraphThree: coverParagraphSchema,
  })
  .strict();

/**
 * Keys the v1 evidence ledger wrote. The ledger was deleted along with AI-added
 * bullets: its two blocking rules only ever judged bullets and numeric claims,
 * so once bullets stopped being generated it guarded a single 350-character
 * field at the cost of two tables and a review pipeline. The summary is now
 * guarded by a deterministic lint at the import boundary instead
 * (`lib/server/ai/summaryLint.ts`), which needs no stored evidence.
 */
const RETIRED_ROOT_KEYS = ["evidence", "review"] as const;

/** Strips the per-proposal evidence pointers v1 rows carry. */
function withoutEvidenceIds(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!("evidenceIds" in record)) return value;
  const { evidenceIds: _retired, ...rest } = record;
  return rest;
}

/**
 * Upgrades a v1 row in place on read: drop the ledger, drop the bullets, keep
 * the summary and the cover letter. A v1 row has no skills selection, and none
 * is invented for it — `cvSchema` leaves it absent and the renderer falls back
 * to the master profile's own skills.
 */
function upgradeLegacyAiContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return value;

  const next: Record<string, unknown> = { ...record };
  next.schemaVersion = AI_CONTENT_SCHEMA_VERSION;
  for (const key of RETIRED_ROOT_KEYS) delete next[key];

  const cv = next.cv;
  if (cv && typeof cv === "object" && !Array.isArray(cv)) {
    const cvRecord = cv as Record<string, unknown>;
    next.cv = { ...cvRecord, summary: withoutEvidenceIds(cvRecord.summary) };
  }

  const cover = next.cover;
  if (cover && typeof cover === "object" && !Array.isArray(cover)) {
    const coverRecord = cover as Record<string, unknown>;
    next.cover = Object.fromEntries(
      Object.entries(coverRecord).map(([key, paragraph]) => [
        key,
        withoutEvidenceIds(paragraph),
      ]),
    );
  }

  return next;
}

export const aiContentSchema = z.preprocess(
  upgradeLegacyAiContent,
  z
    .object({
      schemaVersion: z.literal(AI_CONTENT_SCHEMA_VERSION),
      generatedAt: z.string().datetime(),
      /**
       * Hash of the authoritative generation receipt for the latest import.
       * Empty string is reserved for compatibility-only manual imports that
       * arrived without a complete receipt.
       */
      promptMetaHash: z.string(),
      source: aiImportSourceSchema.optional(),
      /**
       * Authoritative generation metadata for each independently generated
       * target. The legacy root fields above describe only the most recent
       * import and cannot safely attribute a preserved CV or cover letter.
       *
       * Optional for rows written before target-aware provenance existed. A
       * missing target entry means "historically unknown", never "same as the
       * latest root metadata".
       */
      provenance: aiTargetProvenanceSchema.optional(),
      cv: cvSchema,
      cover: coverSchema,
    })
    .strict(),
);

export type AiContent = z.infer<typeof aiContentSchema>;
export type AiGenerationProvenance = z.infer<
  typeof aiGenerationProvenanceSchema
>;
export type AiSummary = z.infer<typeof summarySchema>;
export type AiSkillsSelection = z.infer<typeof skillsSelectionSchema>;
export type AiCoverParagraph = z.infer<typeof coverParagraphSchema>;

/* ───────────────────────── hashing ───────────────────────── */

/**
 * Stable, cross-runtime hash for stale-write detection on /draft and
 * /finalize routes. Two clients editing the same Application from
 * different tabs produce different hashes; the server rejects
 * mismatched hashes with 409.
 *
 * Not cryptographic. Collision risk is acceptable for this UX guard.
 */
export function hashAiContent(content: unknown): string {
  const stable = stableStringify(content);
  return fnv1a32(stable).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return `${JSON.stringify(k)}:${stableStringify(v)}`;
    });
  return `{${entries.join(",")}}`;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
