# Backend — `lib/server/**`

Server modules, their call chains, and the invariants a caller must respect.
Vocabulary is `CONTEXT.md`. Route-layer facts live in
[architecture.md](./architecture.md); schema facts in [data.md](./data.md).

---

## Directory map

| Directory | Owns | Entry points |
|---|---|---|
| `ai/` | Prompt construction, provider calls, the Gemini Tailoring path, evidence/review ledger, cover quality, fit scoring, Skill Pack V3 | `tailorApplication.ts` `tailorApplicationContent`, `buildPrompt.ts`, `providers.ts` `callProvider`, `evidenceLedger.ts` `attachEvidenceAndReview`, `promptContract.ts`, `skillPack.ts` `buildSkillPackV3Files` |
| `applications/` | Application lifecycle: generation acceptance, target-aware AI Content evolution, canonical resume composition, finalize render, artifact commit, ATS validation, advisory lock, review ledger, `ApplicationEvent` append | `applicationGeneration.ts` `acceptApplicationGeneration`, `applicationAiContentAggregate.ts` `evolveApplicationAiContent`, `applicationResumeComposition.ts` `composeApplicationResumeRenderInput`, `commitApplicationArtifact.ts` `commitApplicationArtifact`, `generateApplicationArtifacts.ts`, `manualImportArtifact.ts`, `finalizeApplication.ts`, `persistReviewLedger.ts`, `applicationMutationLock.ts`, `atsPdfValidator.ts` |
| `applicationBatches/` | Codex Batch state machine: claim, complete, cancel, retry | `runner.ts:169` `claimNextBatchTask`, `:282` `completeBatchTask`, `:334`, `:385`; `codexRunContext.ts:81`/`:189`/`:245`; `batchProgress.ts:9` |
| `jobs/` | Job import/list/search/delete/status, fit leasing, cooldown, SimHash dedup, posting risk, liveness, market scoping | `jobImportService.ts:95`, `jobListService.ts:142`, `jobSearchService.ts:11`, `jobDeleteService.ts:69`/`:135`, `fitRunService.ts:262`, `jobMutationLock.ts:23`, `postingRisk.ts:121` |
| `latex/` | Template rendering from `latexTemp/` + the remote render-service client | `compilePdf.ts:68` `compileLatexToPdf`, `renderResume.ts:203`, `renderResumeCN.ts:190`, `renderCoverLetter.ts:69`, `mapResumeProfile.ts:30` |
| `files/` | Blob path construction, PDF filenames | `applicationArtifactBlob.ts:3`, `pdfFilename.ts:24` |
| `discover/` | GitHub trending scrape, YouTube pipeline, durable cache + daily refresh lease (ADR-0005) | `refreshDiscover.ts:107`, `githubTrending.ts:167`, `videoPipeline.ts:431`, `discoverCache.ts:83` |
| `cnFetch/` | CN market Fetch Pipeline: Nowcoder adapter, normalize, per-run processor | `processFetchRun.ts:88`, `adapters/nowcoder.ts:166`, `normalize.ts:223` |
| `sources/` | GLOBAL market Fetch Pipeline: adapter registry, ATS boards, source health, rediscovery, filtering | `processGlobalFetchRun.ts:167`, `registry.ts:45`, `http.ts:48`, `atsRediscoveryService.ts:145`, `sourceHealthStore.ts:62` |
| `fetchRuns/` | FetchRun quota and lifecycle lock, shared by all three market paths | `fetchRunQuota.ts:43`, `fetchRunLifecycleLock.ts:19` |
| `net/` | The single SSRF-hardened outbound gateway | `safeFetch.ts:396` `safeOutboundFetch`, `:272`, `:228` |
| `security/` | Sanitizers for anything persisted or exported | `untrustedOutput.ts:36`/`:58`/`:76` |
| `seek/` | On-demand full-JD enrichment (extension imports carry only a teaser) | `fetchJobDescription.ts:86` |
| `archive/` | Pure ZIP32 writer. Sole consumer: the Skill Pack download | `zip.ts:155` |
| `observability/` | The single error/event reporting seam | `errorReporter.ts:52` `reportError` |
| `auth/` | Session and extension-token primitives | `requireSession.ts:17`, `requireExtensionToken.ts:34`, `constantTimeEqual.ts:12` |
| `api/` | HTTP envelope, session route wrapper, rate limits, LaTeX error mapping | `routeHandler.ts:17` `withSessionRoute`, `errorResponse.ts:9` `errorJson`, `handleLatexError.ts:5` |
| loose files | Master Resume Profile CRUD, Prisma singleton, env validation, extension token/profile/submission, prompt-rule templates | `resumeProfile.ts:170`, `prisma.ts:13`, `env.ts:55`, `promptRuleTemplates.ts:117` |

`prisma.ts:8` throws at module load if `DATABASE_URL` is unset. The client is a
`globalThis` singleton using `PrismaNeon`. Do not construct a standard Prisma
client.

---

## The Tailoring call chain

### Path A — durable server auto-execute

Entry: `generateApplicationArtifactsForJob` from the Application Batch execute
route when `ENABLE_BATCH_EXECUTE_AUTOGEN=1`. The retired session generate
routes are not part of this call chain.

1. `getResumeProfile(userId, {locale})` — `resumeProfile.ts:170`
2. `buildResumePdfForJob` — `buildResumePdf.ts:42`
3. `mapResumeProfile` → LaTeX-escaped render input — `mapResumeProfile.ts:30`
4. `tailorApplicationContent` — `tailorApplication.ts:282`
5. Skill rules: `getActivePromptSkillRulesForUser` — `promptRuleTemplates.ts:117`
6. No `GEMINI_API_KEY` → deterministic fallback (`tailorApplication.ts:100`), unless `requireIndependentReview` → throws `INDEPENDENT_REVIEW_UNAVAILABLE`
7. `buildCoverEvidenceContext` — `coverContext.ts:27`
8. `buildTailorPrompts` builds independent Resume and Cover prompts from the canonical builders; every untrusted field passes `sanitizePromptText`
9. Two target-specific `callProviderWithFallback` calls run concurrently, then strict `parseResumeProviderOutput` / `parseCoverProviderOutput` decode the current contracts
10. Optional Cover gate, rewrite pass, and combined independent-review pass
11. `acceptApplicationGeneration(source = "server_batch")` owns strict contract acceptance, Quality Gates, provenance, evidence, and canonical `AiContent`
12. `composeApplicationResumeRenderInput` composes the accepted Resume delta onto the Master Resume Profile
13. `renderResumeTex` / `renderCoverLetterTex`, then `compileLatexToPdf`

### Path B — manual import / Local AI

Entry: `POST /api/applications/manual-generate`.

1. Prompt built separately by `buildApplicationPromptForUser` — `applicationPrompt.ts:191`. Seek JDs enriched at `:245`
2. Current Resume/Cover prompt responses include a public Tailoring Run
   `{ id, attemptId }` handle. Codex Batch must return it unchanged. During the
   Phase A/B rolling window, an extension talking to an old service may label a
   Local AI response as legacy and import without manufacturing a run; Phase C
   makes the handle mandatory after legacy telemetry reaches zero. A private
   Hermes `run_*` identifier never crosses into Joblit
3. External LLM runs the prompt; the route validates the request envelope with
   `ManualGenerateSchema`
4. The route rebuilds the exact Full or Lean prompt and validates its generation
   receipt with `validatePromptMetaForImport`; stale receipts return
   `PROMPT_META_MISMATCH` 409
5. `acceptApplicationGeneration` selects the decode policy from source: Local AI
   is strict-current; manual import also accepts the bounded v1 compatibility
   dialect
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
  server generation, manual/Local AI generation, and Editor Finalize; generated
  writers also use it as the Tailoring Run acceptance boundary
- `persistReviewLedger` — reached through the commit module plus non-artifact draft and discard transactions

Once a `DRAFT` Application exists, `app/api/applications/[id]/finalize/route.ts`
is the single terminal renderer for both paths (ADR-0002).

---

## The Application artifact commit sequence

All artifact writers use `commitApplicationArtifact`. Generated writers may
prepend the `ABAT -> TLRN` locks and complete Tailoring Run acceptance around
the Application mutation:

**upload → transaction (optional Batch lock → optional Tailoring Run lock →
Application lock → Job ownership recheck → optional aggregate CAS → optional
single-target fold + full re-review → FINAL review gate → hash → upsert →
review ledger → immutable target receipt → run/task projection) → GC
superseded blobs**

When the accepted receipt completes a batch run's required target mask, that
same transaction marks the linked task `SUCCEEDED`. Neither task `PATCH` nor
`run-once` may write success independently; they accept only `FAILED` or
`SKIPPED` with the claimed `attemptId`.

| Caller | Owns | `mergeTarget` | CAS |
|---|---|---:|---:|
| `generateApplicationArtifacts.ts` | CV + Cover | no | no |
| `manual-generate/route.ts` | one target | yes, with required `reviewContext` | no |
| `finalize/route.ts` | already-canonical full aggregate, one rendered artifact | no | `expectedHash` |

Upload failure never clears an existing artifact. A failed transaction, lost
CAS, missing Job, or blocked FINAL deletes the newly uploaded Blob. A
superseded Blob is deleted only after the transaction commits.

Editor Auto-save and discard render no artifact. They retain their own lock +
aggregate-CAS transactions, evolve AI Content through
`evolveApplicationAiContent`, and persist the review ledger.

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

**Blob GC ordering.** `commitApplicationArtifact` deletes the *new* blob when a
commit does not land and deletes the *old* blob only after a successful
transaction.

**Circuit breaker and rate limiter state is per-isolate.** The LaTeX breaker
(`compilePdf.ts:41`) and the rate limiter (`api/rateLimit.ts:15`) are
module-level in-memory. Documented at their definitions.

---

## Outbound network edges

| Destination | Module | Through `safeFetch`? |
|---|---|---|
| Gemini | `providers.ts:143` | Yes — host pinned, no redirects, 2 MiB, 30 s |
| OpenAI | `providers.ts:112` | Yes — reachable only from tests |
| Anthropic | `providers.ts:182` | Yes — reachable only from tests |
| LaTeX render service | `compilePdf.ts:68` | Yes — host pre-parsed, 12 MiB, 20 s. Plain HTTP only under `LATEX_RENDER_ALLOW_INSECURE_HTTP` |
| Vercel Blob put/del | `generateApplicationArtifacts.ts:48`, `finalizeApplication.ts:124`, `jobDeleteService.ts:45` | No — SDK-internal |
| Vercel Blob read (resume photo) | `resumePhotoBlob.ts:99` | Yes — path must be `resume-photos/${userId}/…` |
| GitHub Actions dispatch | `app/api/fetch-runs/[id]/trigger/route.ts:312` | Yes — AU market only |
| GitHub trending HTML | `githubTrending.ts:167` | Yes |
| YouTube Data API | `videoPipeline.ts:431` | Yes |
| ATS boards (Greenhouse, Lever, Ashby, Workable) | `sources/adapters/ats.ts:52` via `sources/http.ts:48` | Yes — adapters get no other network access |
| RemoteOK / Remotive / Jobicy | injected `SourceContext.fetchJson` | Yes |
| ATS careers-page HTML | `atsRediscoveryService.ts:74` | Yes |
| Seek GraphQL | `seek/fetchJobDescription.ts:86` | Yes — job id restricted to `\d+` |
| **Nowcoder (CN)** | `cnFetch/adapters/nowcoder.ts:169` | **No** — bare platform `fetch`. The only edge in `lib/server` that bypasses the gateway |

RSSHub is not implemented. `RSSHUB_URL` / `RSSHUB_JOB_ROUTES` appear only in the
README; `cnFetch/adapters/nowcoder.ts:8` says so explicitly.

---

## Error types

### Classes

| Class | Location | Reaches HTTP via |
|---|---|---|
| `UnauthorizedError` | `auth/requireSession.ts:10` | `withSessionRoute` (`routeHandler.ts:23`), or a hand-rolled `instanceof` in ~10 routes |
| `ExtensionTokenError` | `auth/requireExtensionToken.ts:15` | per-route `instanceof` → 401 |
| `LatexRenderError` | `latex/compilePdf.ts:13` | `handleLatexError` (`api/handleLatexError.ts:5`), which redacts `details`. Re-implemented **without** the redaction at `manual-generate/route.ts:346` |
| `AtsPdfValidationError` | `applications/atsPdfValidator.ts:14` | 422 with the report |
| `SafeOutboundError` | `net/safeFetch.ts:29` | never surfaced directly; translated per caller |
| `ApplicationPromptError` | `applications/applicationPrompt.ts:74` | typed status per code |
| `BatchRunnerError` | `applicationBatches/runner.ts:16` | 404/409, or swallowed as a task outcome |
| `ApplicationRecordNotFoundError` / `ApplicationEventConflictError` | `applications/applicationEventErrors.ts:3`, `:10` | `applicationEventErrorResponse` → 404 / 409 |

### The `throw new Error("SCREAMING_CODE")` convention

A bare `Error` whose message *is* the code. Used at
`generateApplicationArtifacts.ts:95`, `:101`, `:138`; `finalizeApplication.ts:59`,
`:184`, `:194`; `tailorApplication.ts:305`, `:353`, `:476`, `:500`;
`evidenceLedger.ts:358`.

Two of these do not reach the client as a typed error:
`MASTER_PROFILE_MISSING` and `COVER_PARAGRAPHS_INCOMPLETE` escape the finalize
route (which rescues only `AtsPdfValidationError`) and become an untyped Next
500 — while the same failure is a typed 404 `NO_PROFILE` on the manual path.

### Wire shapes

`api/errorResponse.ts:9` `errorJson(code, message, status, {details, requestId})`
is the intended envelope, with helpers `unauthorizedError`, `notFoundError`,
`validationError`. It is not universal: 32 route files emit only a flat
`{error: "CODE"}`, 14 only the envelope, and 15 emit both. `unauthorizedError()`
is called 59 times and passed a `requestId` zero times.

Every unexpected error reaching `withSessionRoute` is passed to `reportError`
before rethrowing (`routeHandler.ts:26`). The 44 hand-copied session preambles
do not do this.

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
