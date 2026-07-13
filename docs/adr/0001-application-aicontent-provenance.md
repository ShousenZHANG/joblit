# ADR-0001: Persist AI provenance on the Application row

- **Status:** Accepted
- **Date:** 2026-05-06
- **Context owner:** Joblit Engineering

## Context

When the user clicks **Generate CV** on a Job, an AI model produces three kinds of mutations on top of the Master Resume Profile:

1. A rewritten **Summary** paragraph.
2. A set of new **bullets** appended to the latest experience.
3. New **skill items** (and possibly new categories).

The cover letter likewise consists of three AI-drafted paragraphs.

Until v1.x the pipeline merged AI proposals into the final document and immediately rendered a PDF — there was no representation of "what the AI proposed" once the merge happened.

We now want an **Edit phase** between generation and PDF render, where the user reviews each AI proposal individually (accept / reject / inline edit). This requires a stable representation of:

- The AI's original proposal for each editable field.
- The user's decision on it.
- (For audit / regression analysis) the version of the prompt rules that produced it.

## Decision

Add an `aiContent` JSON column to `Application`. Persist the full structured snapshot of every AI proposal plus the user's edits on every save.

Schema sketch:

```ts
type AiContent = {
  cv: {
    summary: { aiText: string; originalText: string };
    latestExperience: {
      experienceIndex: number;
      addedBullets: Array<{
        text: string;        // AI's original proposal
        userEdit?: string;   // user's overwrite, if any
        accepted: boolean;
        qualityGate?: { passed: boolean; reason?: string };
      }>;
    };
    skillsAdditions: Array<{
      label: string;
      items: string[];
      accepted: boolean;
    }>;
  };
  cover: {
    paragraphOne: { aiText: string; userEdit?: string; accepted: boolean };
    paragraphTwo: { aiText: string; userEdit?: string; accepted: boolean };
    paragraphThree: { aiText: string; userEdit?: string; accepted: boolean };
  };
  generatedAt: string;
  promptMetaHash: string;    // hash of skill pack version + prompt rule template
  schemaVersion: number;     // bumped when AiContent shape changes
};
```

Pair this with `aiContentHash` (sha256 of the JSON) for stale-write detection across concurrent tabs.

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
- **Quality regression analysis** — `promptMetaHash` lets us bucket acceptance rates by prompt version.
- **Cheap "Reset to AI"** — every editable field has its own `aiText` to revert to.
- **Migration target is additive** — adding versioning later (a side `ApplicationVersion` table) does not require reshaping `aiContent`.

### Negative

- **Storage cost** — each Application carries a JSON blob of ~5–20 KB. Not material for the current scale (single-tenant SaaS, low thousands of rows). Revisit if rows reach low millions.
- **Schema lock-in** — changing the `AiContent` shape requires a `schemaVersion` bump and a forward-compatible reader. Migrations are linear-scan, not free.
- **Hydration coupling** — the Edit page must understand the JSON shape; bugs in shape vs. UI cause silent data loss. Mitigate with Zod validation at the API boundary.

### Neutral

- The `manualImportArtifact.ts` pipeline already produces the necessary intermediate values (`addedBullets`, `skillsAdditions`); persisting them is mechanical.
- The existing **Quality Gate** stays in place — it now decorates `aiContent.addedBullets[i].qualityGate` instead of dropping bullets silently.

## Rollout

1. Schema migration adds `aiContent: Json?`, `aiContentHash: String?`, `status: ApplicationStatus`.
2. Existing rows backfill `status = FINAL`, `aiContent = NULL`. Editing them prompts the user to re-generate.
3. New rows always populate `aiContent`. Finalize commits the JSON and renders the PDF from it.

## References

- `prisma/schema.prisma` — Application model
- `lib/server/applications/manualImportArtifact.ts` — current bullet pipeline
- ADR-0002 — Unified tailor → edit → finalize flow
- CONTEXT.md — `Application`, `AI Content`, `Quality Gate`
