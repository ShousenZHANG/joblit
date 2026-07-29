# ADR-0002: Unified draft → edit → finalize flow across both generation paths

- **Status:** Accepted
- **Date:** 2026-05-06
- **Context owner:** Joblit Engineering

> **Accepted amendment:** Feature-gated server auto-execute uses the durable
> generation service and may finalize without the interactive Edit phase.
> External Codex orchestration claims work through `run-once` and imports model
> output through `manual-generate`. Neither mode calls a retired session
> generation route.

> **Accepted amendment (2026-07-24):** Every Application resume path, including
> direct FINAL, server batch, preview, and DRAFT-to-FINAL, composes its render
> input through `composeApplicationResumeRenderInput`. The Master Resume Profile
> remains the document spine; canonical `aiContent` may replace the summary and
> append accepted bullets, but skills and existing bullets remain Master-owned.
> The coordinated current generation contract and Skill Pack V3 emit
> `cvSummary` plus zero to three `latestExperience.addedBullets`; they do not
> emit skills or the existing bullet list. Cover generation emits only
> `paragraphOne`, `paragraphTwo`, and `paragraphThree` under `cover`. Any legacy
> import normalization is a compatibility boundary, not a generated or
> distributed contract.

> **Accepted amendment (2026-07-24, version identity):** The historical
> `PromptMeta.skillPackVersion` name is retained on the import receipt, but its
> semantics are a **generation receipt version** over the effective rules,
> prompt/schema contract, and Master Resume Profile snapshot. The Skill Pack V3
> download header `x-skill-pack-version` is a separate **download content
> version** over the final sorted logical file names and contents. The values
> are deterministic but are not expected to be byte-equal because they identify
> different artifacts. ZIP timestamps and wall-clock generation dates are
> excluded from both. The download response also exposes
> `x-generation-receipt-version`; the UI requires it to equal the current
> prompt receipt before marking a locale-specific pack as fresh.

> **Accepted amendment (2026-07-24, durable generation paths):** The two
> session routes that rendered without persisting an Application,
> `/api/applications/generate` and
> `/api/applications/generate-cover-letter`, are retired. Interactive external
> generation persists through `POST /api/applications/manual-generate`; durable
> server-side generation persists through
> `executeServerBatchTailoringTask`, exclusively from the Application Batch
> `execute` workflow. Its Batch/task/issue/attempt identity is mandatory,
> missing targets come from the authoritative Tailoring Run, and the final
> commit compares the Application content hash captured before generation.
> Preview and Editor Finalize read the same persisted Application aggregate.

> **Accepted amendment (2026-07-28, document publication):** Resume and Cover
> publish independently. `Application.status` is now a compatibility projection
> of the present document publications; routes do not set the entire aggregate
> Final merely because one target rendered. Target content and published hashes
> are defined by ADR-0011.

## Context

Joblit has two ways to produce AI proposals for an Application:

| Path | Endpoint | When used |
|---|---|---|
| **Manual** | `POST /api/applications/manual-generate` | User pastes JSON from an external LLM (Claude, ChatGPT, Gemini web). Today's primary path. |
| **Server auto-execute** | `POST /api/application-batches/:id/execute` | When enabled, claims work and persists generation through `executeServerBatchTailoringTask`. |
| **External Codex** | `POST /api/application-batches/:id/run-once` + `manual-generate` | Claims/completes work externally, then persists returned model output through the manual import boundary. |

Manual and internal paths historically rendered the PDF and finalized the
Application atomically. The current system retains one persisted Edit model:
manual import and the durable server generation service both commit an
Application aggregate before Preview, Edit, or Finalize reads it.

## Decision

**Both durable paths converge through the same persisted Application
aggregate and Edit phase.** Manual import may opt out of Edit with
`finalize=true`; server auto-execute calls the durable generation service.

Concretely:

- `POST /api/applications/manual-generate?finalize=false` → writes `aiContent`,
  re-projects document publication status, **does not render PDF**, and returns
  `{ applicationId }`. UI then routes to `/jobs/[id]/tailor`.
- `POST /api/applications/manual-generate?finalize=true` → renders and publishes
  the requested artifact immediately. Aggregate status is derived from all
  present documents.
- `executeServerBatchTailoringTask` is the durable server-side generation path
  used by feature-gated Application Batch auto-execute. It cannot run without
  a Tailoring Run identity and target receipts, and persists the aggregate and
  artifacts as one CAS-protected service operation.
- `POST /api/applications/[id]/finalize` → reads `aiContent` from the row,
  renders and publishes the selected document. Called from the Edit page's
  Finalize button.
- `PATCH /api/applications/[id]/draft` → autosave hook for incremental `aiContent` updates from the Edit page.

The default for interactive manual callers is `finalize=false`. External Codex
uses `manual-generate?finalize=true`; server auto-execute does not call a
session generation route or depend on its query flags.

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
- **Server auto-execute remains atomic** through the durable generation
  service. External Codex persists through the same manual import boundary used
  by the interactive workflow.
- **Easy to introduce new AI providers** — they all flow through the same Edit phase.
- **Per-document revisits are cheap** — editing one Final document makes only
  that document Draft and keeps the other publication current.
- **Failed generations are well-defined** — a generation that fails the Zod schema parse never writes a row, leaving the app's previous state intact.

### Negative

- **Two endpoints (`/draft`, `/finalize`) instead of one atomic write** — slightly larger surface area to test and document.
- **State coupling between routes** — `/finalize` reads `aiContent` written by `/draft`; a stale read against a concurrent draft write would render the wrong PDF. Mitigated by `aiContentHash` on the finalize call (rejects mismatches).
- **Two durable entry points must preserve one contract**: manual import and
  server batch share canonical output parsing, composition, and Application
  commit semantics. Contract tests gate this convergence.

### Neutral

- The `aiContent` JSON shape is defined in ADR-0001 and is path-agnostic.
- The Edit page (`/jobs/[id]/tailor`) only cares that `aiContent` exists — it doesn't care which model produced it.

## Rollout

1. **Phase 1 (completed):** Add `?finalize` to manual generation; the web UI
   defaults to `false`.
2. **Phase 1**: Implement `/draft` (PATCH) and `/finalize` (POST) endpoints.
3. **Phase 1**: Web UI navigates to `/jobs/[id]/tailor` after generation when `finalize=false`.
4. **Completed:** retire the two non-persisting session generation routes and
   route server generation through the receipt-backed
   `executeServerBatchTailoringTask` interface.

## References

- `app/api/applications/manual-generate/route.ts`
- `lib/server/applications/applicationGeneration.ts`
- `lib/server/applications/executeServerBatchTailoringTask.ts`
- `AGENTS.md` — Codex Batch protocol
- ADR-0001 — Application AI provenance
- ADR-0011 — document-level Application publication
- CONTEXT.md — `Tailoring`, `Codex Batch`, `Application Status`
