# ADR-0001: Persist AI provenance on the Application row

- **Status:** Accepted
- **Date:** 2026-05-06
- **Context owner:** Joblit Engineering

> **Accepted amendment — 2026-07-24:** CV and Cover are independently
> generated targets within one `aiContent` aggregate. Each target may carry its
> own authoritative generation provenance. Target replacement preserves the
> other target's content and known provenance, then rebuilds evidence and
> review for the combined aggregate. This is an additive, optional schema-v1
> field so legacy rows remain readable; missing provenance means historically
> unknown and must never be inferred from the latest root metadata.
>
> Generation output is a separate, versioned contract. The current contract is
> prompt template `2026.07.v2` / output schema `2026-07-24`. `local_ai`,
> `codex_batch`, and `server_batch` must use that contract and an authoritative
> target receipt. `manual_import` alone retains a compatibility reader for
> legacy user-supplied JSON; compatibility inputs do not expand the current
> generation contract.

## Context

When the user clicks **Generate CV** on a Job, an AI model produces two kinds of
proposals on top of the Master Resume Profile:

1. A rewritten **Summary** paragraph.
2. A set of new **bullets** appended to the latest experience.

Skills and skill categories are not AI generation outputs. They remain owned by
the Master Resume Profile. The cover letter consists of three AI-drafted
paragraphs.

Until v1.x the pipeline merged AI proposals into the final document and immediately rendered a PDF — there was no representation of "what the AI proposed" once the merge happened.

We now want an **Edit phase** between generation and PDF render, where the user reviews each AI proposal individually (accept / reject / inline edit). This requires a stable representation of:

- The AI's original proposal for each editable field.
- The user's decision on it.
- (For audit / regression analysis) the version of the prompt rules that produced it.

## Decision

Add an `aiContent` JSON column to `Application`. Persist the structured
snapshot of the current proposal for each Application target, plus the user's
edits.

Schema sketch:

```ts
type GenerationProvenance = {
  generatedAt: string;
  promptMetaHash: string;
  source: "manual_import" | "local_ai" | "codex_batch" | "server_batch";
};

type AiContent = {
  schemaVersion: 1;

  // Legacy/latest-import metadata; not authoritative for a preserved target.
  generatedAt: string;
  promptMetaHash: string;
  source?: "manual_import" | "local_ai" | "codex_batch";

  provenance?: {
    resume?: GenerationProvenance;
    cover?: GenerationProvenance;
  };

  cv: {
    summary: {
      aiText: string;
      originalText: string;
      userEdit?: string;
      accepted: boolean;
      evidenceIds?: string[];
    };
    latestExperience: {
      experienceIndex: number;
      addedBullets: Array<{
        text: string;
        userEdit?: string;
        accepted: boolean;
        qualityGate?: { passed: boolean; reason?: string };
        evidenceIds?: string[];
      }>;
    };
  };
  cover: {
    paragraphOne: { aiText: string; userEdit?: string; accepted: boolean };
    paragraphTwo: { aiText: string; userEdit?: string; accepted: boolean };
    paragraphThree: { aiText: string; userEdit?: string; accepted: boolean };
  };

  evidence?: EvidenceReference[];
  review?: ApplicationReview;
};
```

The current model-facing output contract is strict and target-specific:

```ts
// Prompt template 2026.07.v2 / output schema 2026-07-24
type ResumeGenerationOutput = {
  cvSummary: string;
  latestExperience: {
    addedBullets: string[]; // 0..3; additions only
  };
};

type CoverGenerationOutput = {
  cover: {
    paragraphOne: string;
    paragraphTwo: string;
    paragraphThree: string;
  };
};
```

Unknown keys and legacy generated fields such as `skillsFinal` are rejected on
all current-only paths. The authoritative `promptMetaHash` binds the target,
prompt variant, exact prompt bytes, effective rules, locale, Resume snapshot,
Job snapshot, prompt-template version, and output-schema version. A
`codex_batch` import must echo the complete `promptMeta` issued for that exact
job and target; batch run context exposes contract identity only and is not a
generation receipt.

Pair this with `aiContentHash`, a stable non-cryptographic hash of canonicalized
JSON, for stale-write detection across concurrent tabs. It is a UX
compare-and-swap guard, not a security digest.

## Alternatives considered

### Diff-time recomputation

Recompute "what was AI-added" each time the Edit page loads by diffing the tailored draft against the Master Resume Profile.

**Rejected because:**

- Once the user edits an AI bullet, we can no longer recover the AI's original proposal. The diff produces "user edited bullet text" with no way to show **Reset to AI**.
- The diff is ambiguous in edge cases — a small phrasing change to an existing bullet looks like an AI add.
- We lose the ability to cleanly attribute regressions to specific prompt versions ("acceptance rate dropped 20% after skill pack v3").

### Full tailored document + AI bullet indices

Persist the entire merged tailored document and a parallel array `aiBulletIndices: number[]`.

**Rejected because:**

- Indices are fragile — any reorder/insert breaks them.
- Doesn't carry quality gate verdicts, which we want to surface in the UI.
- Doesn't support the cover letter's per-paragraph accept/reject model.

### Separate `ApplicationDraft` table

A dedicated table for in-progress edits, gating the existing `Application` row to only ever hold finalized state.

**Rejected because:**

- Doubles the schema for a single-author, single-row use case.
- Re-edit-after-finalize then needs to copy between tables. With the in-place `status` field, the same row carries the lifecycle — see ADR-0002.

## Consequences

### Positive

- **Visual diff is cheap** — the Edit panel reads `aiContent` directly, no server-side diff required.
- **Lossless audit** — even after the user finalizes a heavily-edited application, we still have the AI's original proposal stored.
- **Quality regression analysis** — per-target `promptMetaHash` lets us bucket acceptance rates without attributing the latest target's prompt to a preserved target.
- **Cheap "Reset to AI"** — every editable field has its own `aiText` to revert to.
- **Migration target is additive** — adding versioning later (a side `ApplicationVersion` table) does not require reshaping `aiContent`.

### Negative

- **Storage cost** — each Application carries a JSON blob of ~5–20 KB. Not material for the current scale (single-tenant SaaS, low thousands of rows). Revisit if rows reach low millions.
- **Schema lock-in** — non-additive shape changes require a `schemaVersion` bump and a forward-compatible reader. Additive optional metadata must retain honest legacy semantics. Migrations are linear-scan, not free.
- **Hydration coupling** — the Edit page must understand the JSON shape; bugs in shape vs. UI cause silent data loss. Mitigate with Zod validation at the API boundary.

### Neutral

- `applicationGeneration.ts` is the canonical issue/accept boundary for current
  Resume and Cover outputs, validation, evidence, and target provenance.
- `manualImportArtifact.ts` adapts manual/local/Codex imports to that boundary
  and records provenance only for the imported target.
- `applicationAiContentAggregate.ts` owns target preservation, browser-edit filtering, discard semantics, and merge-before-review ordering.
- `commitApplicationArtifact.ts` folds a single target under the Application mutation lock and persists the rebuilt aggregate and review ledger together.
- The existing **Quality Gate** stays in place — it now decorates `aiContent.addedBullets[i].qualityGate` instead of dropping bullets silently.

## Rollout

1. Schema migration adds `aiContent: Json?`, `aiContentHash: String?`, `status: ApplicationStatus`.
2. Existing rows backfill `status = FINAL`, `aiContent = NULL`. Editing them prompts the user to re-generate.
3. New rows always populate `aiContent`. Finalize commits the JSON and renders the PDF from it.
4. Target-aware provenance is lazy and additive. Existing rows are not backfilled with guessed provenance.
5. The next generation of a target writes that target's provenance. A preserved legacy target remains without a provenance entry until it is regenerated.

## References

- `prisma/schema.prisma` — Application model
- `lib/shared/schemas/applicationGenerationOutput.ts` — current model-facing
  Resume/Cover output schemas
- `lib/server/applications/applicationGeneration.ts` — canonical acceptance
  boundary
- `lib/server/applications/manualImportArtifact.ts` — import adapter
- ADR-0002 — Unified tailor → edit → finalize flow
- CONTEXT.md — `Application`, `AI Content`, `Quality Gate`
