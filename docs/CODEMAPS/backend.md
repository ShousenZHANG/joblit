# Backend — `lib/server/**`

Server modules, their call chains, and the invariants a caller must respect.
Vocabulary is `CONTEXT.md`. Route-layer facts live in
[architecture.md](./architecture.md); schema facts in [data.md](./data.md).

---

## Directory map

| Directory              | Owns                                                                                                                                                                                                                     | Entry points                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai/`                  | Prompt construction, evidence/review ledger, cover quality, Skill Pack V3. No provider client — generation is local-first (ADR-0015)                                                                        | `buildPrompt.ts`, `evidenceLedger.ts` `attachEvidenceAndReview`, `promptContract.ts`, `skillPack.ts` `buildSkillPackV3Files`                                                                                                                                                                                                                                                                      |
| `applications/`        | Application lifecycle: generation acceptance, target-aware AI Content evolution, canonical resume composition, finalize render, artifact commit, ATS validation, advisory lock, review ledger, `ApplicationEvent` append | `applicationGeneration.ts` `acceptApplicationGeneration`, `applicationAiContentAggregate.ts` `evolveApplicationAiContent`, `applicationResumeComposition.ts` `composeApplicationResumeRenderInput`, `commitApplicationArtifact.ts` `commitApplicationArtifact`, `manualImportArtifact.ts`, `finalizeApplication.ts`, `persistReviewLedger.ts`, `applicationMutationLock.ts`, `atsPdfValidator.ts` |
| `artifacts/`           | ADR-0010 Application Blob lifecycle, account-erasure hooks, Vercel adapter, inventory, claim/call/fenced settle                                                                                                          | `applicationArtifactLifecycle.ts` `prepareApplicationArtifactsForAccountErasure` / `purgeDeletedApplicationArtifactsForErasedUser`, `artifactReconciler.ts`, `artifactBlobPort.ts`, `vercelBlobAdapter.ts`                                                                                                                                                                                        |
| `jobs/`                | Job import/list/search/delete/status, cooldown, SimHash dedup, posting risk, market scoping                                                                                   | `jobImportService.ts`, `jobListService.ts`, `jobSearchService.ts`, `jobDeleteService.ts`, `jobMutationLock.ts`, `postingRisk.ts`                                                                                                                                                                                                                         |
| `latex/`               | Template rendering from `latexTemp/` + the remote render-service client                                                                                                                                                  | `compilePdf.ts:69` `compileLatexToPdf`, `renderResume.ts:204`, `renderResumeCN.ts:190`, `renderCoverLetter.ts:81`, `mapResumeProfile.ts:30`                                                                                                                                                                                                                                                       |
| `files/`               | Blob path construction, PDF filenames                                                                                                                                                                                    | `applicationArtifactBlob.ts:3`, `pdfFilename.ts:24`                                                                                                                                                                                                                                                                                                                                               |
| `discover/`            | GitHub trending scrape + durable last-known-good cache, refreshed on demand by the nav popover (ADR-0005 superseded)                                                                                                     | `githubTrending.ts:174`, `discoverCache.ts`                                                                                                                                                                                                                                                                                                                                                       |
| `fetchRuns/`           | AU worker lifecycle, stale-run policy, attempt/dispatch locks, and the shared `fetch-run-commit/v1` transaction boundary                                                                                                 | `dispatchGithubFetchRun.ts`, `fetchRunCommit.ts`, `fetchRunStale.ts`, `fetchRunLifecycleLock.ts`, `triggerClaim.ts`                                                                                                                                                                                                                                                                               |
| `net/`                 | The single SSRF-hardened outbound gateway                                                                                                                                                                                | `safeFetch.ts:396` `safeOutboundFetch`, `:272`, `:228`                                                                                                                                                                                                                                                                                                                                            |
| `security/`            | Sanitizers for anything persisted or exported                                                                                                                                                                            | `untrustedOutput.ts:36`/`:58`/`:76`                                                                                                                                                                                                                                                                                                                                                               |
| `archive/`             | Pure ZIP32 writer. Sole consumer: the Skill Pack download                                                                                                                                                                | `zip.ts:155`                                                                                                                                                                                                                                                                                                                                                                                      |
| `observability/`       | The single error/event reporting seam                                                                                                                                                                                    | `errorReporter.ts:52` `reportError`                                                                                                                                                                                                                                                                                                                                                               |
| `auth/`                | Session primitives. Agent credentials went with the Runner (ADR-0022)                                                                                                                                                                | `requireSession.ts:17` `requireSession`, `:28` `requireSessionWithEmail`, `constantTimeEqual.ts`                                                                                                                                                                                                                                                                                                                          |
| `runtimeCapabilities/` | Typed interpretation of optional integrations, paired credentials, feature flags, and safe fallback states                                                                                                               | `index.ts` `resolveRuntimeCapabilities` / `getRuntimeCapabilities`                                                                                                                                                                                                                                                                                                                                |
| `api/`                 | HTTP envelope, the session route wrapper, rate limits, typed `AppError`/database-error mapping, LaTeX error mapping                                                                                                                                  | `routeHandler.ts:64` `withSessionRoute`, `:101` `withEmailSessionRoute`, `errorResponse.ts:16` `errorJson`, `appError.ts`, `databaseError.ts`, `handleLatexError.ts:5`                                                                                                                                                                                                                                                                                    |
| loose files            | Master Resume Profile CRUD, Prisma singleton, env validation, prompt-rule templates, list ETag, pagination, resume-photo Blob reads                                                                                      | `resumeProfile.ts`, `prisma.ts`, `env.ts`, `promptRuleTemplates.ts`, `jobsListEtag.ts`, `pagination.ts`, `resumePhotoBlob.ts`                                                                                                                                                                                                                                                                     |

`prisma.ts:8` throws at module load if `DATABASE_URL` is unset. The client is a
`globalThis` singleton using `PrismaNeon` (`:11`). Do not construct a standard
Prisma client.

`lib/server/cnFetch/`, `lib/server/sources/` and `lib/server/dataRetirement/`
survive as empty directories only; git tracks no file under them.

---

## The Tailoring call chain

### Retired paths

Server auto-execute went with the Gemini provider chain (ADR-0015); the Runner,
the batch queue and the TailoringRun ledger went with ADR-0022. The server
never runs a model, and
`test/architecture/legacyApplicationGenerateRoute.test.ts` keeps every
server-side generation surface from returning.

### The only path — manual import

Issue: `POST /api/applications/prompt`. Import:
`POST /api/applications/manual-generate`. Both are `withSessionRoute`.

1. `POST /api/applications/prompt` calls `buildApplicationPromptForUser`
   (`applicationPrompt.ts`) for one target and returns the prompt. It is a pure
   read — it mints nothing and writes nothing
2. The user pastes the prompt into a chatbot and pastes the JSON back; the
   import route validates the envelope with `ManualGenerateSchema`, whose
   `source` is now `z.literal("manual_import")` — the browser is the only
   writer
3. The route rebuilds the exact Full or Lean prompt and validates its generation
   receipt with `validatePromptMetaForImport`; stale receipts return
   `PROMPT_META_MISMATCH` 409
4. `acceptApplicationGeneration` decodes the output. `manual_import` accepts the
   strict-current dialect plus the bounded v1 compatibility dialect. The
   `codex_batch`, `server_batch` and `local_ai` members survive in
   `ApplicationGenerationSource` and `aiContent.ts` only so stored provenance on
   old rows still parses; none of them has a writer
5. The same accept seam owns normalization, Resume bullet
   grounding/non-redundancy gates, Cover quality, provenance, evidence, and
   canonical `AiContent`
6. `commitApplicationArtifact({ mergeTarget, reviewContext })` folds the
   single target into the stored aggregate under the Application lock,
   preserves the other target and its known provenance, then re-reviews the
   complete aggregate. `reviewContext` is mandatory whenever `mergeTarget` is
   present
7. `?finalize=false` commits `DRAFT` with no artifact — this is what the browser
   always sends. The default `finalize=true` still compiles and ATS-validates
   during import through `buildManualImportArtifact`; nothing in the repository
   calls it. A blocked combined review cleans up the new Blob
8. Publishing is a separate, target-scoped call to
   `POST /api/applications/:id/finalize`

The current external output contract is intentionally small: Resume returns
`cvSummary` and zero to three `latestExperience.addedBullets`; Cover returns
only its three body paragraphs. Existing bullets and skills remain owned by the
Master Resume Profile.

There is no receipt-based import idempotency left. The probe that made a
repeated POST replay the earlier verdict lived in the TailoringRun table; the
browser dialog's in-flight guard is what remains, and a DRAFT import compiles
no PDF. `/finalize` keeps its own replay
(`applicationPublicationReplay.ts`), which turns a repeated click into a read
rather than another LaTeX compile and upload.


`GET /api/prompt-rules/skill-pack` converts the user's active effective
`PromptRuleTemplate` into the Skill Pack V3 structured representation. The
download header hashes the final sorted logical files. This download content
version is distinct from the generation receipt version retained in
`PromptMeta.skillPackVersion`; `x-generation-receipt-version` proves that the
download used the same locale-specific profile and effective rules before the
UI marks it fresh. See ADR-0002.

### Convergence

- `evolveApplicationAiContent` — the single interface for target replacement, client Edit commands, review refresh, and discard
- `acceptApplicationGeneration` — the single interface for generated output parsing, compatibility policy, Quality Gates, target provenance, evidence, and initial canonical `AiContent`
- `attachEvidenceAndReview` — rebuilds the aggregate-wide evidence and review projection
- `composeApplicationResumeRenderInput` — the single pure composition seam for
  direct FINAL, Preview, and Editor Finalize. It combines the
  Master Resume Profile spine with canonical `aiContent.cv`; model-only skills
  and reordered base bullets cannot bypass persisted Application state.
- `compileLatexToPdf` — the single renderer
- `commitApplicationArtifact` — the artifact persistence sequence shared by
  manual import and Editor Finalize
- `persistReviewLedger` — reached through the commit module plus non-artifact draft and discard transactions

Once a `DRAFT` Application exists, `app/api/applications/[id]/finalize/route.ts`
is the single terminal renderer (ADR-0002). It publishes exactly one target per
call.

---

## The Application artifact commit sequence

All artifact writers use `commitApplicationArtifact`. ADR-0022 removed the run
half of this sequence: `acquireUnboundApplicationWriteAuthority` and the
`ABAT → TLRN` pair are gone, because all three of their steps existed to
interleave with the TailoringRun table. What actually serialises two writers to
one Application is `acquireApplicationMutationLock` (`JOBA`), taken
independently and unchanged.

**durable STAGED row → upload → record URL → transaction (JOBA → ownership
recheck → optional aggregate CAS → FINAL review gate → Application update +
REFERENCED transition + superseded DELETE_PENDING outbox → review ledger)**

The document-level publication state that transaction writes — the four
`Application` hash columns and `transitionApplicationPublication` — survives
ADR-0020 intact. Only the immutable dual-receipt fence around it died.

| Caller                     | Owns                                                    |                      `mergeTarget` |            CAS |
| -------------------------- | ------------------------------------------------------- | ---------------------------------: | -------------: |
| `manual-generate/route.ts` | one target                                              | yes, with required `reviewContext` |             no |
| `finalize/route.ts`        | already-canonical full aggregate, one rendered artifact |                                 no | `expectedHash` |

Upload failure never clears an existing artifact. A failed transaction, lost
CAS, missing Job, or blocked FINAL durably retires any completed upload; a
superseded Blob becomes eligible only after its replacement transaction
commits. The protected reconciler owns both external deletion and settlement.

Editor Auto-save and discard render no artifact. They retain their own lock +
aggregate-CAS transactions, evolve AI Content through
`evolveApplicationAiContent`, and persist the review ledger.

### ADR-0010 lifecycle cutover status

This change implements Phase A and Phase B together: the additive
`ApplicationArtifact` schema and current-pointer backfill ship with the writer,
Job-deletion retirement outbox, and protected reconciliation worker. Production
still deploys the migration before the application binary so no new writer can
target a missing table.

The runtime reserves a `STAGED` pathname before upload, transitions it
to `REFERENCED` in the same transaction as the Application URL pointer, and
records every superseded or failed artifact as durable retirement work.
Deletion uses claim → external call → claim-fenced settle. An expired stage
whose upload response was lost can be deleted idempotently by pathname even
when its URL was never recorded.

Path reuse stops permanently when retirement begins. Exact retries reuse only
an active stage/reference; a later generation of the same bytes receives a UUID
incarnation pathname. This is the cross-system ABA fence for a delayed external
delete whose database claim has expired. The current-pointer safety check uses
a finite lookup for trusted writer paths and a capped, fail-closed legacy scan
for metadata-null migration/inventory rows. A reappearing `DELETED` Blob is
requeued for deletion, never restored to an active lifecycle state.

The inventory reconciler is restricted to the `applications/` prefix. Before
any delete it must query all four current Application URL columns as a second
reference fence. It drains the outbox first, then processes at most two
50-object inventory pages and persists a leased, claim-fenced cursor.
`resume-photos/` and the Resume Photo module are outside this lifecycle. The
scheduled route has no inventory, claim, or delete side effect unless
`ARTIFACT_RECONCILE_ENABLED` is exactly `true` or `1`. Production enables that
kill switch only after the writer is deployed and old binaries have drained;
rollout and backfill rules are in ADR-0010.

Account erasure is a required service integration point, not a currently
wired route. The future User-deletion transaction must call
`prepareApplicationArtifactsForAccountErasure` before deleting the User in the
same transaction. It immediately queues all unclaimed tenant artifacts,
preserves/reports active deletion claims, and removes rows already settled as
`DELETED`. After the worker settles the asynchronous tail,
`purgeDeletedApplicationArtifactsForErasedUser` refuses to purge unless the
User row is absent. The reconciler's absent-user sweep covers an in-flight
writer that stages after the pre-delete scan.

---

## Invariants a caller must respect

**Advisory locks must be the first statement of their transaction**
(`jobMutationLock.ts:7-9`). Use `$executeRaw`, never `$queryRaw` —
`pg_advisory_xact_lock` returns `void`, which the driver adapter cannot
deserialize (`applicationMutationLock.ts:10-12`, enforced in
`db/advisoryLock.ts`).

**Lock ordering**: broader lock first, then Application locks in sorted job-id
order (`applicationMutationLock.ts:8-10`). Honoured in `jobDeleteService.ts:207`
→ `:219` and `:292` → `:307`. Nothing enforces it.

**Evidence scope key must be `userId`.** `attachEvidenceAndReview` derives every
evidence id from it. The parameter is required and there is no anonymous
fallback; `assertCanonicalEvidenceReferences` checks the tenant-bound ids again
before ledger persistence.

**Evolve AI Content through one interface.**
`evolveApplicationAiContent` owns target preservation, per-target provenance,
browser-edit filtering, discard semantics, and merge-before-review ordering.
Routes express an intent rather than manually spreading an `AiContent` object.

**A single-target replacement requires canonical review context.**
`CommitInput` makes `reviewContext` mandatory whenever `mergeTarget` is
present. The target is folded into the current row under the Application lock
and the combined CV + Cover aggregate is re-reviewed before persistence.

**Client payloads are edit commands, not snapshots.**
Only `accepted` and `userEdit` are copied from browser content. Model output,
Quality Gate results, target provenance, evidence, review, and hashes remain
server-owned.

**The hash and review are aggregate-wide.**
Target replacement and every evidence-aware browser edit, review refresh, or
discard rebuild the complete CV + Cover review. `Application.aiContentHash`
protects the complete snapshot; per-target provenance does not introduce
per-target review, hashes, CAS, or lifecycle state.

**FINAL never trusts missing legacy review metadata.**
Editor Finalize always rebuilds evidence/review from the owned Master Resume
Profile and Job, including for schema-v1 rows that predate evidence fields.
A non-null stored `aiContent` that fails schema validation is not treated as an
empty aggregate; single-target generation fails closed instead of erasing the
preserved target.

**Blob lifecycle ordering.** Reserve `STAGED` before `put`; make the new object
`REFERENCED` and the old object `DELETE_PENDING` with the Application mutation;
perform no external delete until after that transaction. The worker settles
only the UUID claim it owns.

**Circuit breaker and rate limiter state is per-isolate.** The LaTeX breaker
(`compilePdf.ts:42`) and the rate limiter (`api/rateLimit.ts:14`) are
module-level in-memory. Documented at their definitions.

---

## Outbound network edges

| Destination                     | Module                                                                                            | Through `safeFetch`?                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| LaTeX render service            | `compilePdf.ts:127`                                                                               | Yes — host pre-parsed, 12 MiB, 20 s. Plain HTTP only under `LATEX_RENDER_ALLOW_INSECURE_HTTP` |
| Vercel Blob put/list/del        | `artifacts/vercelBlobAdapter.ts`, reached through Application commit and the protected reconciler | No — SDK-internal                                                                             |
| Vercel Blob read (resume photo) | `app/api/resume-pdf/route.ts:90`, path from `resumePhotoBlob.ts`                                              | Yes — path must be `resume-photos/${userId}/…`                                                |
| GitHub Actions dispatch         | `fetchRuns/dispatchGithubFetchRun.ts:44`                                                          | Yes — AU market only                                                                          |
| GitHub trending HTML            | `githubTrending.ts:174`                                                                           | Yes                                                                                           |

CN discovery and GLOBAL public-feed/ATS/source-health execution edges were
removed in Stage 1 (ADR-0017). Their names may still appear in immutable
migrations, historical ADRs, and URL risk/canonicalization fixtures; none is an
active outbound integration.

---

## Error types

### Classes

| Class                                                              | Location                                          | Reaches HTTP via                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppError`                                                         | `api/appError.ts:19`                              | `toErrorResponse` (`:73`) — the canonical envelope; `privateDetails` is reported, never returned                                                       |
| `UnauthorizedError`                                                | `auth/requireSession.ts:10`                       | `withSessionRoute` / `withEmailSessionRoute` → canonical 401                                                                                          |
| `LatexRenderError`                                                 | `latex/compilePdf.ts:14`                          | `handleLatexError` (`api/handleLatexError.ts:5`), which redacts `details`                                                                             |
| `AtsPdfValidationError`                                            | `applications/atsPdfValidator.ts:15` (an `AppError`) | 422 with the report                                                                                                                                |
| `SafeOutboundError`                                                | `net/safeFetch.ts:29`                             | never surfaced directly; translated per caller                                                                                                        |
| `ApplicationPromptError`                                           | `applications/applicationPrompt.ts:55`            | typed status per code                                                                                                                                 |
| `ApplicationRecordNotFoundError` / `ApplicationEventConflictError` | `applications/applicationEventErrors.ts:3`, `:10` | `applicationEventErrorResponse` → 404 / 409                                                                                                           |

`api/databaseError.ts:74` `classifyDatabaseError` names the Prisma/Postgres
failure that caused a rejection so a deterministic database error surfaces as a
stable code rather than being replayed or hidden behind a bare 500.

### The `throw new Error("SCREAMING_CODE")` convention

A bare `Error` whose message _is_ the code remains in internal composition and
evidence paths. The public failures that used to escape it are now typed:
`COVER_PARAGRAPHS_INCOMPLETE` is an `AppError` 422 raised in
`applications/finalizeApplication.ts:117`, and `MASTER_PROFILE_MISSING` no
longer exists — the missing-profile case is a typed 404 `NO_PROFILE`.

### Wire shapes

`api/errorResponse.ts:16` `errorJson(code, message, status, {details, requestId})`
is the required envelope, with helpers `unauthorizedError`, `notFoundError`,
and `validationError`; the route architecture guard rejects flat wire errors.

`withSessionRoute` runs every handler inside a `try`: a typed failure becomes
the canonical envelope through `toErrorResponse`, and anything else is passed
to `reportError` and answered with the unexpected-error response. Route modules
do not duplicate that cross-cutting concern.

---

## Tests

Well covered: the pure modules — `evidenceLedger`, `promptContract`,
`responsibilityCoverage`, `coverQuality`, `safeFetch` (URL policy, redirect
header stripping, private-address rejection), `compilePdf` (PDF integrity
floor), `jobImportService` (394 lines, the largest).

`applicationAiContentAggregate.test.ts` directly covers target preservation,
per-target provenance, legacy attribution, full-aggregate re-review, forged
browser provenance, discard, review timestamps, and fail-closed canonical
sources. `commitApplicationArtifact.test.ts` covers CAS, invalid stored
content, FINAL review blocking, partial-upload rollback, and Blob-GC ordering.

Known gap, stated so a reader does not assume coverage:

- Many files in `test/api/` mock Prisma with filter-blind `vi.fn()`s, so an
  ownership-filter regression may not fail unless the test asserts the
  `findFirst` argument.
