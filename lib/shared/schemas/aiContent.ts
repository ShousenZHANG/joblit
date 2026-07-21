import { z } from "zod";

/**
 * Versioned snapshot of every AI proposal made for an Application,
 * paired with the user's accept/reject/edit decisions. Persisted on
 * Application.aiContent (JSON column).
 *
 * See ADR-0001 for the rationale (persistence vs diff-time recompute).
 *
 * SCHEMA VERSIONING:
 * Bump AI_CONTENT_SCHEMA_VERSION whenever the JSON shape changes in a
 * non-additive way. The migration plan must convert older rows during
 * deploy; readers should reject unknown versions explicitly.
 */
export const AI_CONTENT_SCHEMA_VERSION = 1;

const qualityGateSchema = z
  .object({
    passed: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();

const addedBulletSchema = z
  .object({
    text: z.string(),
    userEdit: z.string().optional(),
    accepted: z.boolean(),
    qualityGate: qualityGateSchema.optional(),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{32}$/)).max(8).optional(),
  })
  .strict();

const summarySchema = z
  .object({
    aiText: z.string(),
    originalText: z.string(),
    userEdit: z.string().optional(),
    accepted: z.boolean().default(true),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{32}$/)).max(12).optional(),
  })
  .strict();

const latestExperienceSchema = z
  .object({
    experienceIndex: z.number().int().nonnegative(),
    addedBullets: z.array(addedBulletSchema),
  })
  .strict();

/**
 * `skillsAdditions` (the AI's proposed new CV skill groups) was retired: the
 * model kept proposing skills the candidate had no evidence for, so the
 * grounding gate blocked finalize on almost every draft it produced.
 *
 * Rows written before the removal still carry the key, and every other field
 * here stays `.strict()` on purpose — an unknown key is a signal that a client
 * is smuggling server-owned state. Rather than loosen that guarantee for the
 * whole object, drop this one retired key before validation so an old row (or
 * a browser tab loaded before the deploy) still reads back cleanly instead of
 * failing with AI_CONTENT_INVALID. No data migration is required; the key
 * disappears on the next write.
 */
const cvSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!("skillsAdditions" in value)) return value;
  const { skillsAdditions: _retired, ...rest } = value as Record<string, unknown>;
  return rest;
}, z
  .object({
    summary: summarySchema,
    latestExperience: latestExperienceSchema,
  })
  .strict());

const coverParagraphSchema = z
  .object({
    aiText: z.string(),
    userEdit: z.string().optional(),
    accepted: z.boolean(),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{32}$/)).max(12).optional(),
  })
  .strict();

const coverSchema = z
  .object({
    paragraphOne: coverParagraphSchema,
    paragraphTwo: coverParagraphSchema,
    paragraphThree: coverParagraphSchema,
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    id: z.string().regex(/^ev_[0-9a-f]{32}$/),
    kind: z.enum(["candidate", "job"]),
    path: z.string().min(1).max(160),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    excerpt: z.string().min(1).max(480),
  })
  .strict();

const requirementCoverageSchema = z
  .object({
    id: z.string().regex(/^req_[0-9a-f]{16}$/),
    text: z.string().min(1).max(500),
    status: z.enum(["covered", "partial", "missing"]),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{32}$/)).max(12),
  })
  .strict();

/** Exported so a client parsing a blocked-finalize payload validates against
 *  the same shape the server serialises, instead of trusting its own guess. */
export const applicationReviewSchema = z
  .object({
    verdict: z.enum(["pass", "revise", "blocked"]),
    reviewedAt: z.string().datetime(),
    coveragePercent: z.number().int().min(0).max(100),
    requirements: z.array(requirementCoverageSchema).max(12),
    issues: z.array(z.string().min(1).max(300)).max(20),
  })
  .strict();

export const aiContentSchema = z
  .object({
    schemaVersion: z.literal(AI_CONTENT_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    /**
     * Hash of the prompt rule template + skill pack version that
     * produced this content. Empty string while the prompt-version
     * tracking is unwired (Phase 4 will populate). Tightening to
     * `.min(1)` is intentionally deferred — see ADR-0001.
     */
    promptMetaHash: z.string(),
    source: z.enum(["manual_import", "local_ai"]).optional(),
    evidence: z.array(evidenceReferenceSchema).max(320).optional(),
    review: applicationReviewSchema.optional(),
    cv: cvSchema,
    cover: coverSchema,
  })
  .strict();

export type AiContent = z.infer<typeof aiContentSchema>;
export type AiAddedBullet = z.infer<typeof addedBulletSchema>;
export type AiSummary = z.infer<typeof summarySchema>;
export type AiCoverParagraph = z.infer<typeof coverParagraphSchema>;
export type AiEvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type AiApplicationReview = z.infer<typeof applicationReviewSchema>;

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
