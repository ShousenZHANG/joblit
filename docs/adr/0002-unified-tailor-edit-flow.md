# ADR-0002: Unified draft → edit → finalize flow across both generation paths

- **Status:** Accepted
- **Date:** 2026-05-06
- **Context owner:** Joblit Engineering

> **Accepted amendment:** ADR-0004 keeps current Codex Batch `finalize=true` behavior only as a migration exception. When ADR-0004 Phase 4 ships, Codex Batch will generate evidence-complete drafts instead of immediately finalizing. All other decisions in this ADR remain active.

> **Accepted amendment (2026-07-24):** Every Application resume path, including
> direct FINAL, server batch, preview, and DRAFT-to-FINAL, composes its render
> input through `composeApplicationResumeRenderInput`. The Master Resume Profile
> remains the document spine; canonical `aiContent` may replace the summary and
> append accepted bullets, but skills and existing bullets remain Master-owned.
> Legacy `skillsFinal` input is accepted for compatibility and has no render
> effect. During the compatibility window, existing versioned strict contracts
> may still require the field; removing it requires a coordinated Prompt Schema
> and Skill Pack version bump.

## Context

Joblit has two ways to produce AI proposals for an Application:

| Path | Endpoint | When used |
|---|---|---|
| **Manual** | `POST /api/applications/manual-generate` | User pastes JSON from an external LLM (Claude, ChatGPT, Gemini web). Today's primary path. |
| **Internal** | `POST /api/applications/generate` | Server calls Gemini directly. Used when `GEMINI_API_KEY` is configured and the user prefers one-click. |
| **Codex Batch** | `POST /api/application-batches/:id/run-once` | Loops over `NEW` jobs without human review. Used by the external batch agent (see `AGENTS.md`). |

Both manual and internal paths historically rendered the PDF and finalized the Application atomically. Adding a user-review **Edit phase** introduces a fork: do we add Edit to one path or both?

## Decision

**Both paths converge through a single Edit phase**, which the caller can opt out of via a `finalize=true` flag.

Concretely:

- `POST /api/applications/manual-generate?finalize=false` → writes `aiContent`, sets `status = DRAFT`, **does not render PDF**, returns `{ applicationId }`. UI then routes to `/jobs/[id]/tailor`.
- `POST /api/applications/manual-generate?finalize=true` → today's behavior. Renders PDF immediately, sets `status = FINAL`. Used by Codex Batch.
- Same flag pattern on `/api/applications/generate`.
- New endpoint `POST /api/applications/[id]/finalize` → reads `aiContent` from row, renders PDF, sets `status = FINAL`. Called from the Edit page's Finalize button.
- `PATCH /api/applications/[id]/draft` → autosave hook for incremental `aiContent` updates from the Edit page.

The default for interactive (web UI) callers is `finalize=false`. The default for Codex Batch is `finalize=true`.

## Alternatives considered

### Edit phase only on the manual path

Manual is the primary user path; internal Gemini path is "fast lane".

**Rejected because:**

- Splits the UX into two surfaces — users would see different post-generation flows depending on which AI ran. That is a leaky abstraction.
- Internal Gemini occasionally produces low-quality bullets (no JD evidence, repetitions). Without an Edit phase, the user has no escape valve other than re-running.
- Future "tailor with Claude API" / "tailor with OpenAI API" paths would need to make the same choice again. A unified flow normalizes the question.

### Edit phase only on the internal path

Manual stays atomic; internal gets the new flow.

**Rejected because:**

- Manual is today's primary path. Locking it out of the Edit phase locks out 90% of the user value.

### Two-phase commit endpoints (separate `/proposal` and `/finalize`)

Make every generation route only ever produce a draft, and require a second call to finalize. Codex Batch then chains the two.

**Rejected because:**

- Doubles the round-trip cost for batch processing (two API calls per job × hundreds of jobs).
- Requires Codex Batch to know about the two-phase contract — a coupling we explicitly want to avoid.
- The `?finalize=true` flag is functionally identical and one round-trip cheaper.

## Consequences

### Positive

- **One UX surface** for human review regardless of which model produced the AI proposals.
- **Codex Batch unchanged in steady state** — it keeps passing `finalize=true` and gets the old atomic semantics.
- **Easy to introduce new AI providers** — they all flow through the same Edit phase.
- **Per-application revisits are cheap** — re-edit a `FINAL` application by flipping `status` back to `DRAFT` without re-generating.
- **Failed generations are well-defined** — a generation that fails the Zod schema parse never writes a row, leaving the app's previous state intact.

### Negative

- **Two endpoints (`/draft`, `/finalize`) instead of one atomic write** — slightly larger surface area to test and document.
- **State coupling between routes** — `/finalize` reads `aiContent` written by `/draft`; a stale read against a concurrent draft write would render the wrong PDF. Mitigated by `aiContentHash` on the finalize call (rejects mismatches).
- **Codex Batch must remember to set the flag** — a forgotten flag would leave Codex-produced rows in `DRAFT`. Mitigated by defaulting `?finalize=true` only when the request is authenticated with `IMPORT_SECRET`/batch context, and adding a server-side assertion that any unauthenticated batch context is rejected.

### Neutral

- The `aiContent` JSON shape is defined in ADR-0001 and is path-agnostic.
- The Edit page (`/jobs/[id]/tailor`) only cares that `aiContent` exists — it doesn't care which model produced it.

## Rollout

1. **Phase 1**: Add `?finalize` flag to both generation routes. Web UI defaults to `false`; Codex Batch (and any caller without a session) defaults to `true`.
2. **Phase 1**: Implement `/draft` (PATCH) and `/finalize` (POST) endpoints.
3. **Phase 1**: Web UI navigates to `/jobs/[id]/tailor` after generation when `finalize=false`.
4. **Phase 2/3**: Cover Letter route (`/api/applications/generate-cover-letter`) gets the same flag.

## References

- `app/api/applications/manual-generate/route.ts`
- `app/api/applications/generate/route.ts`
- `AGENTS.md` — Codex Batch protocol
- ADR-0001 — Application AI provenance
- CONTEXT.md — `Tailoring`, `Codex Batch`, `Application Status`
