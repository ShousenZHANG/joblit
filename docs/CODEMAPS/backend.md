# Backend — `lib/server/**`

Server modules, their call chains, and the invariants a caller must respect.
Vocabulary is `CONTEXT.md`. Route-layer facts live in
[architecture.md](./architecture.md); schema facts in [data.md](./data.md).

---

## Directory map

| Directory | Owns | Entry points |
|---|---|---|
| `ai/` | Prompt construction, provider calls, the Gemini Tailoring path, evidence/review ledger, cover quality, fit scoring, Skill Pack | `tailorApplication.ts:282` `tailorApplicationContent`, `buildPrompt.ts:29`, `providers.ts:211` `callProvider`, `evidenceLedger.ts:331` `attachEvidenceAndReview`, `promptContract.ts:212`, `skillPack.ts:209` |
| `applications/` | Application row lifecycle: artifact build, manual-import parse, Quality Gate, canonical AI Content merge, finalize render, ATS validation, advisory lock, review ledger, `ApplicationEvent` append | `generateApplicationArtifacts.ts:80`, `manualImportArtifact.ts:90`, `manualImportParser.ts` (gates `:419`, `:450`), `finalizeApplication.ts:105`/`:137`, `canonicalAiContent.ts:43`/`:83`, `mergeAiContentForTarget.ts:13`, `persistReviewLedger.ts:64`, `applicationMutationLock.ts:26`, `atsPdfValidator.ts:150` |
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

### Path A — Gemini, server-side

Entry: `POST /api/applications/generate`, or `generateApplicationArtifactsForJob`
(`generateApplicationArtifacts.ts:80`) from the Codex Batch execute route.

1. `getResumeProfile(userId, {locale})` — `resumeProfile.ts:170`
2. `buildResumePdfForJob` — `buildResumePdf.ts:42`
3. `mapResumeProfile` → LaTeX-escaped render input — `mapResumeProfile.ts:30`
4. `tailorApplicationContent` — `tailorApplication.ts:282`
5. Skill rules: `getActivePromptSkillRulesForUser` — `promptRuleTemplates.ts:117`
6. No `GEMINI_API_KEY` → deterministic fallback (`tailorApplication.ts:100`), unless `requireIndependentReview` → throws `INDEPENDENT_REVIEW_UNAVAILABLE`
7. `buildCoverEvidenceContext` — `coverContext.ts:27`
8. `buildTailorPrompts` — `buildPrompt.ts:29`; every untrusted field passes `sanitizePromptText` (`ai/sanitize.ts:39`)
9. `callProviderWithFallback` → `callGemini` — `providers.ts:143`. 12 s abort, retry on 429/502/503/504
10. `parseTailorModelOutput` — `ai/schema.ts:271`
11. Optional cover gate → rewrite pass → independent reviewer pass — `tailorApplication.ts:371`, `:387`, `:449`
12. `renderResumeTex` — `renderResume.ts:203`
13. `compileLatexToPdf` — `compilePdf.ts:68`

### Path B — manual import / Local AI

Entry: `POST /api/applications/manual-generate`.

1. Prompt built separately by `buildApplicationPromptForUser` — `applicationPrompt.ts:191`. Seek JDs enriched at `:245`
2. External LLM runs it; JSON is POSTed back, validated by `ManualGenerateSchema` — `manualImportParser.ts:11`
3. Skill Pack freshness: `validatePromptMetaForImport` — `promptContract.ts:227` → `PROMPT_META_MISMATCH` 409
4. `buildManualImportArtifact({evidenceScopeKey: userId, …})` — `manualImportArtifact.ts:90`
5. Parse — `manualImportParser.ts:123`/`:222`/`:273`
6. **Quality Gate** — `canonicalizeLatestBullets` (`:483`), then per bullet `isGroundedAddedBullet` (`:419`) and `isNonRedundantAddedBullet` (`:450`). Verdict written to `AiAddedBullet.qualityGate`; failing bullets are dropped from the rendered TeX
7. `attachEvidenceAndReview` — `evidenceLedger.ts:331`
8. `?finalize=false` → commit `DRAFT`, no render. Otherwise `compileLatexToPdf`

### Convergence

- `attachEvidenceAndReview` — both paths produce the same AI Content shape
- `compileLatexToPdf` — the single renderer
- `persistReviewLedger` — `persistReviewLedger.ts:64`, called from five sites

Once a `DRAFT` Application exists, `app/api/applications/[id]/finalize/route.ts`
is the single terminal renderer for both paths (ADR-0002).

---

## The Application commit sequence

Canonical shape: **render → ATS validate → upload → transaction (lock → recheck
→ write → ledger) → GC stale blobs**. It exists in three places, and they
differ.

| | `generateApplicationArtifacts.ts` | `manual-generate/route.ts` | `finalize/route.ts` |
|---|---|---|---|
| Scope | CV **and** cover in one call | One target per call | One target per call |
| Write | `upsert`, always overwrites (`:222`) | `upsert` (`:119`) | **CAS** `updateMany` on `aiContentHash` + prior URL (`:327`, `:410`) |
| Stale-write guard | none | none | `expectedHash` → `STALE_WRITE` 409 (`:162`) |
| Merge obligation | n/a | `mergeAiContentForTarget` (`:90`) | n/a — rebuilds canonical |
| Upload failure | `.catch(() => null)`, commits a null URL (`:182-193`) | reported, commits a null URL that **clears the previous PDF** (`:391-400`) | delete the new blob, rethrow (`:443-457`) |
| Rollback | `deleteBlobUrls` (`:66`) | inline `del` (`:419`) | `deleteApplicationArtifact` (`finalizeApplication.ts:224`), silent no-op without a Blob token |
| Lock key | `jobId` (`:199`) | `jobId` (`:77`) | `existing.jobId ?? existing.id` (`:322`) |
| Blob version | `${Date.now()}-${uuid.slice(0,8)}` | `${hashAiContent()}-${uuid}` | `${canonicalHash}-${uuid}` |
| Idempotency | none | none | short-circuits when the versioned URL already carries `canonicalHash` (`:262-286`) |

The finalize path is the reference implementation. The other two predate it.

Sharing the lock+CAS shape without a render: `draft/route.ts:78-185` (autosave)
and `discard/route.ts:93-113`.

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
evidence id from it (`evidenceLedger.ts:28-30`). The parameter is optional and
silently defaults to the literal `"anonymous"` (`:332`), which produces a ledger
that `assertCanonicalEvidenceReferences` will later reject with
`INVALID_EVIDENCE_REFERENCE` (`:358`).

**Merge before persisting a single-target artifact.** `manual-generate` produces
a complete AI Content whose non-target half is empty stubs
(`manualImportArtifact.ts:76-82`). Persisting it directly erases the other
artifact. `mergeAiContentForTarget` (`mergeAiContentForTarget.ts:13`) is the
only guard, and the obligation is documented only in that file's comment.

**Client payloads are edit commands, not snapshots.**
`mergeClientAiContentEdits` (`canonicalAiContent.ts:43`) takes only `accepted`
and `userEdit` from the browser. Model output, evidence, review results, hashes
and source metadata stay server-owned.

**Re-review after any edit.** `refreshEvidenceReview` (`evidenceLedger.ts:324`)
re-evaluates edited content against the immutable snapshot, so an edit cannot
retain a stale `pass` verdict. It is a no-op when `evidence` is empty.

**Blob GC ordering.** Delete the *new* blob when the CAS loses; delete the *old*
blob only after it wins (`finalize/route.ts:366`, `:371`).

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

67 colocated `.test.ts` under `lib/server/`, 35 more in `test/server/`, plus
`test/api/` for routes.

Well covered: the pure modules — `evidenceLedger`, `promptContract`,
`responsibilityCoverage`, `coverQuality`, `safeFetch` (URL policy, redirect
header stripping, private-address rejection), `compilePdf` (PDF integrity
floor), `jobImportService` (437 lines, the largest).

Known gaps, stated so a reader does not assume coverage:

- `assertAtsPdf` is stubbed to *resolve* `{passed:true}` in
  `generateApplicationArtifacts.test.ts:139-146`; the real contract throws. A
  double returning `{passed:false}` would also pass, so the test cannot detect a
  deleted gate.
- `finalizeApplication.test.ts` fixtures use `addedBullets: []` and
  `experiences: []`, so neither branch of the ADR-0001 composition rule at
  `finalizeApplication.ts:77-86` executes, and `buildAtsKeywords` is never
  called.
- The Quality Gate has no direct test. `bulletSimilarityScore` and its threshold
  are unexercised.
- 35 of 46 files in `test/api/` mock Prisma with filter-blind `vi.fn()`s, so an
  ownership filter regression would not fail a test. Only two files assert a
  `findFirst` argument.
