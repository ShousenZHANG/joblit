# Backend — `lib/server/**`

Server modules, their call chains, and the invariants a caller must respect.
Vocabulary is `CONTEXT.md`. Route-layer facts live in
[architecture.md](./architecture.md); schema facts in [data.md](./data.md).

---

## Directory map

| Directory | Owns | Entry points |
|---|---|---|
| `ai/` | Prompt construction, evidence/review ledger, cover quality, fit scoring, Skill Pack V3. No provider client — generation is local-first (ADR-0015) | `buildPrompt.ts`, `evidenceLedger.ts` `attachEvidenceAndReview`, `promptContract.ts`, `skillPack.ts` `buildSkillPackV3Files` |
| `applications/` | Application lifecycle: generation acceptance, target-aware AI Content evolution, canonical resume composition, finalize render, artifact commit, ATS validation, advisory lock, review ledger, `ApplicationEvent` append | `applicationGeneration.ts` `acceptApplicationGeneration`, `applicationAiContentAggregate.ts` `evolveApplicationAiContent`, `applicationResumeComposition.ts` `composeApplicationResumeRenderInput`, `commitApplicationArtifact.ts` `commitApplicationArtifact`, `manualImportArtifact.ts`, `finalizeApplication.ts`, `persistReviewLedger.ts`, `applicationMutationLock.ts`, `atsPdfValidator.ts` |
| `artifacts/` | ADR-0010 Application Blob lifecycle, account-erasure hooks, Vercel adapter, inventory, claim/call/fenced settle | `applicationArtifactLifecycle.ts` `prepareApplicationArtifactsForAccountErasure` / `purgeDeletedApplicationArtifactsForErasedUser`, `artifactReconciler.ts`, `artifactBlobPort.ts`, `vercelBlobAdapter.ts` |
| `applicationBatches/` | Codex Batch state machine: claim, complete, cancel, retry | `runner.ts:169` `claimNextBatchTask`, `:282` `completeBatchTask`, `:334`, `:385`; `codexRunContext.ts:81`/`:189`/`:245`; `batchProgress.ts:9` |
| `jobs/` | Job import/list/search/delete/status, fit leasing and receipt-backed settlement, cooldown, SimHash dedup, posting risk, liveness, market scoping | `jobImportService.ts`, `jobListService.ts`, `jobSearchService.ts`, `jobDeleteService.ts`, `fitRunService.ts`, `fitBatchImport.ts`, `jobMutationLock.ts`, `postingRisk.ts` |
| `latex/` | Template rendering from `latexTemp/` + the remote render-service client | `compilePdf.ts:68` `compileLatexToPdf`, `renderResume.ts:203`, `renderResumeCN.ts:190`, `renderCoverLetter.ts:69`, `mapResumeProfile.ts:30` |
| `files/` | Blob path construction, PDF filenames | `applicationArtifactBlob.ts:3`, `pdfFilename.ts:24` |
| `discover/` | GitHub trending scrape + durable last-known-good cache, refreshed on demand by the nav popover (ADR-0005 superseded) | `githubTrending.ts:167`, `discoverCache.ts` |
| `cnFetch/` | CN market discovery adapter: Nowcoder fetch, normalization, diagnostics, terminal-plan construction | `processFetchRun.ts`, `adapters/nowcoder.ts`, `normalize.ts` |
| `sources/` | GLOBAL market discovery adapter: registry, ATS boards, source health, rediscovery, filtering, terminal-plan construction | `processGlobalFetchRun.ts`, `registry.ts`, `http.ts`, `atsRediscoveryService.ts`, `sourceHealthStore.ts` |
| `fetchRuns/` | Inline lifecycle coordinator, stale-run policy, attempt/dispatch locks, and the shared `fetch-run-commit/v1` transaction boundary | `executeInlineFetchRun.ts`, `inlineFetchRunAdapter.ts`, `fetchRunCommit.ts`, `fetchRunStale.ts`, `fetchRunLifecycleLock.ts`, `triggerClaim.ts` |
| `net/` | The single SSRF-hardened outbound gateway | `safeFetch.ts:396` `safeOutboundFetch`, `:272`, `:228` |
| `security/` | Sanitizers for anything persisted or exported | `untrustedOutput.ts:36`/`:58`/`:76` |
| `archive/` | Pure ZIP32 writer. Sole consumer: the Skill Pack download | `zip.ts:155` |
| `observability/` | The single error/event reporting seam | `errorReporter.ts:52` `reportError` |
| `auth/` | Session and capability-scoped agent-credential primitives | `requireSession.ts`, `requireAgentCredential.ts`, `constantTimeEqual.ts` |
| `runtimeCapabilities/` | Typed interpretation of optional integrations, paired credentials, feature flags, and safe fallback states | `index.ts` `resolveRuntimeCapabilities` / `getRuntimeCapabilities` |
| `api/` | HTTP envelope, session/AgentCredential route wrappers, rate limits, LaTeX error mapping | `routeHandler.ts` `withSessionRoute` / `withAgentRoute`, `errorResponse.ts` `errorJson`, `handleLatexError.ts` |
| loose files | Master Resume Profile CRUD, Prisma singleton, env validation, agent credentials, prompt-rule templates | `resumeProfile.ts`, `prisma.ts`, `env.ts`, `agentCredential.ts`, `promptRuleTemplates.ts` |

`prisma.ts:8` throws at module load if `DATABASE_URL` is unset. The client is a
`globalThis` singleton using `PrismaNeon`. Do not construct a standard Prisma
client.

---

## The Tailoring call chain

### Path A — retired (server auto-execute)

Removed with the Gemini provider chain (ADR-0015). The server never runs a
model; `test/architecture/legacyApplicationGenerateRoute.test.ts` keeps every
server-side generation surface from returning.

### Path B — manual import / Runner

Entry: `POST /api/applications/manual-generate`.

1. Prompt built separately by `buildApplicationPromptForUser` — `applicationPrompt.ts`
2. Current Resume/Cover prompt responses include a public Tailoring Run
   `{ id, attemptId }` handle. Codex Batch must return it unchanged. During the
   Phase A/B rolling window a client talking to an old service may label a
   response as legacy and import without manufacturing a run; Phase C makes the
   handle mandatory after legacy telemetry reaches zero. A private Hermes
   `run_*` identifier never crosses into Joblit
3. External LLM runs the prompt; the route validates the request envelope with
   `ManualGenerateSchema`
4. The route rebuilds the exact Full or Lean prompt and validates its generation
   receipt with `validatePromptMetaForImport`; stale receipts return
   `PROMPT_META_MISMATCH` 409
5. `acceptApplicationGeneration` selects the decode policy from source:
   `codex_batch`/Runner is strict-current; `manual_import` also accepts the
   bounded v1 compatibility dialect. The retired `local_ai` writer is not an
   active source
6. The same accept seam owns normalization, Resume bullet
   grounding/non-redundancy gates, Cover quality, provenance, evidence, and
   canonical `AiContent`
7. `buildManualImportArtifact` is a pure rendering adapter over the accepted
   canonical result
8. `commitApplicationArtifact({ mergeTarget, reviewContext, tailoring })`
   validates the run attempt and immutable target receipt before the Application
   mutation, folds that target into the stored aggregate, preserves the other
   target and its known provenance, then re-reviews the complete aggregate
9. `?finalize=false` commits `DRAFT` with no artifact. FINAL mode compiles and
   validates the requested PDF before commit; a blocked combined review returns
   `review_blocked` and the new Blob is cleaned up

The current external output contract is intentionally small: Resume returns
`cvSummary` and zero to three `latestExperience.addedBullets`; Cover returns
only its three body paragraphs. Existing bullets and skills remain owned by the
Master Resume Profile.

The first-party adapter for this path is `tools/runner/`. It polls the
server-owned Tailoring Run while Hermes executes and requires the exact active
`{ id, attemptId }` on every non-terminal response. Unknown import settlements
replay the same immutable prompt/run receipt; a superseded attempt, cancellation
or exhausted unknown settlement is deferred rather than reported as a failure
against a newer executor. `run-once` exposes a bounded lease retry hint when a
batch is still running but no task is claimable.

The Fit path uses a parallel but separate receipt seam in
`jobs/fitBatchImport.ts`. Its content-addressed 64-hex issue binds sorted Job
ids to the prompt snapshot; `FitBatchImportReceipt` and Job score updates commit
atomically, so a lost response can replay before prompt reconstruction even if
the active profile or rules later change. The Agent-only
`fit/settlement-status` read validates that receipt for startup cleanup, while
the session-only `fit/cancel` command linearizes with leasing on the same
per-user advisory lock and terminally fences late imports.

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
  direct FINAL, server batch, Preview, and Editor Finalize. It combines the
  Master Resume Profile spine with canonical `aiContent.cv`; model-only skills
  and reordered base bullets cannot bypass persisted Application state.
- `compileLatexToPdf` — the single renderer
- `commitApplicationArtifact` — the artifact persistence sequence shared by
  server generation, manual/Agent Runner generation, and Editor Finalize; generated
  writers also use it as the Tailoring Run acceptance boundary
- `persistReviewLedger` — reached through the commit module plus non-artifact draft and discard transactions

Once a `DRAFT` Application exists, `app/api/applications/[id]/finalize/route.ts`
is the single terminal renderer for both paths (ADR-0002).

---

## The Application artifact commit sequence

All artifact writers use `commitApplicationArtifact`. Generated writers may
prepend the `ABAT -> TLRN` locks and complete Tailoring Run acceptance around
the Application mutation:

**durable STAGED row → upload → record URL → transaction (optional Batch lock
→ optional Tailoring Run lock → Application lock → Job ownership recheck →
optional aggregate CAS → optional single-target fold + full re-review → FINAL
review gate → hash → Application upsert + REFERENCED transition + superseded
DELETE_PENDING outbox → review ledger → immutable target receipt → run/task
projection)**

When the accepted receipt completes a batch run's required target mask, that
same transaction marks the linked task `SUCCEEDED`. Neither task `PATCH` nor
`run-once` may write success independently; they accept only `FAILED` or
`SKIPPED` with the claimed `attemptId`.

| Caller | Owns | `mergeTarget` | CAS |
|---|---|---:|---:|
| `manual-generate/route.ts` | one target | yes, with required `reviewContext` | no |
| `finalize/route.ts` | already-canonical full aggregate, one rendered artifact | no | `expectedHash` |

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
(`jobMutationLock.ts:19`). Use `$executeRaw`, never `$queryRaw` —
`pg_advisory_xact_lock` returns `void`, which the driver adapter cannot
deserialize (`applicationMutationLock.ts:22-24`).

**Lock ordering**: broader lock first, then Application locks in sorted job-id
order (`applicationMutationLock.ts:16-25`). Honoured in `jobDeleteService.ts:77`
→ `:87` and `:150` → `:160-165`. Nothing enforces it.

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
(`compilePdf.ts:41`) and the rate limiter (`api/rateLimit.ts:15`) are
module-level in-memory. Documented at their definitions.

---

## Outbound network edges

| Destination | Module | Through `safeFetch`? |
|---|---|---|
| OpenAI | `providers.ts:112` | Yes — reachable only from tests |
| Anthropic | `providers.ts:182` | Yes — reachable only from tests |
| LaTeX render service | `compilePdf.ts:68` | Yes — host pre-parsed, 12 MiB, 20 s. Plain HTTP only under `LATEX_RENDER_ALLOW_INSECURE_HTTP` |
| Vercel Blob put/list/del | `artifacts/vercelBlobAdapter.ts`, reached through Application commit and the protected reconciler | No — SDK-internal |
| Vercel Blob read (resume photo) | `resumePhotoBlob.ts:99` | Yes — path must be `resume-photos/${userId}/…` |
| GitHub Actions dispatch | `app/api/fetch-runs/[id]/trigger/route.ts:312` | Yes — AU market only |
| GitHub trending HTML | `githubTrending.ts:167` | Yes |
| YouTube Data API | `videoPipeline.ts:431` | Yes |
| ATS boards (Greenhouse, Lever, Ashby, Workable) | `sources/adapters/ats.ts:52` via `sources/http.ts:48` | Yes — adapters get no other network access |
| RemoteOK / Remotive / Jobicy | injected `SourceContext.fetchJson` | Yes |
| ATS careers-page HTML | `atsRediscoveryService.ts:74` | Yes |
| **Nowcoder (CN)** | `cnFetch/adapters/nowcoder.ts:169` | **No** — bare platform `fetch`. The only edge in `lib/server` that bypasses the gateway |

RSSHub is not implemented. `RSSHUB_URL` / `RSSHUB_JOB_ROUTES` appear only in the
README; `cnFetch/adapters/nowcoder.ts:8` says so explicitly.

---

## Error types

### Classes

| Class | Location | Reaches HTTP via |
|---|---|---|
| `UnauthorizedError` | `auth/requireSession.ts` | `withSessionRoute` and `withAgentRoute` |
| `AgentCredentialError` | `auth/requireAgentCredential.ts` | `withAgentRoute` → canonical 401 |
| `LatexRenderError` | `latex/compilePdf.ts:13` | `handleLatexError` (`api/handleLatexError.ts:5`), which redacts `details`. Re-implemented **without** the redaction at `manual-generate/route.ts:346` |
| `AtsPdfValidationError` | `applications/atsPdfValidator.ts:14` | 422 with the report |
| `SafeOutboundError` | `net/safeFetch.ts:29` | never surfaced directly; translated per caller |
| `ApplicationPromptError` | `applications/applicationPrompt.ts:74` | typed status per code |
| `BatchRunnerError` | `applicationBatches/runner.ts:16` | 404/409, or swallowed as a task outcome |
| `ApplicationRecordNotFoundError` / `ApplicationEventConflictError` | `applications/applicationEventErrors.ts:3`, `:10` | `applicationEventErrorResponse` → 404 / 409 |

### The `throw new Error("SCREAMING_CODE")` convention

A bare `Error` whose message *is* the code remains in internal provider,
composition, and evidence paths. Public server-batch ownership, profile,
concurrency, and persistence failures are translated to `AppError` by
the retired server auto-execute path; provider details never became task output.

Two of these do not reach the client as a typed error:
`MASTER_PROFILE_MISSING` and `COVER_PARAGRAPHS_INCOMPLETE` escape the finalize
route (which rescues only `AtsPdfValidationError`) and become an untyped Next
500 — while the same failure is a typed 404 `NO_PROFILE` on the manual path.

### Wire shapes

`api/errorResponse.ts` `errorJson(code, message, status, {details, requestId})`
is the required envelope, with helpers `unauthorizedError`, `notFoundError`,
and `validationError`; the route architecture guard rejects flat wire errors.

Every unexpected error reaching `withSessionRoute` or `withAgentRoute` is
passed to `reportError`. Route modules do not duplicate that cross-cutting
concern.

---

## Tests

Well covered: the pure modules — `evidenceLedger`, `promptContract`,
`responsibilityCoverage`, `coverQuality`, `safeFetch` (URL policy, redirect
header stripping, private-address rejection), `compilePdf` (PDF integrity
floor), `jobImportService` (437 lines, the largest).

`applicationAiContentAggregate.test.ts` directly covers target preservation,
per-target provenance, legacy attribution, full-aggregate re-review, forged
browser provenance, discard, review timestamps, and fail-closed canonical
sources. `commitApplicationArtifact.test.ts` covers CAS, invalid stored
content, FINAL review blocking, partial-upload rollback, and Blob-GC ordering.

Known gap, stated so a reader does not assume coverage:

- Many files in `test/api/` mock Prisma with filter-blind `vi.fn()`s, so an
  ownership-filter regression may not fail unless the test asserts the
  `findFirst` argument.
