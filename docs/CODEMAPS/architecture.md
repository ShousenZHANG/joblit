# Architecture — Joblit

System-level snapshot. Read this first, then the map for the area you are
changing: [backend](./backend.md), [frontend](./frontend.md),
[data](./data.md), [dependencies](./dependencies.md).

Vocabulary is `CONTEXT.md`. Decisions are `docs/adr/`. Where this document and
the code disagree, the code wins — fix the document.

---

## What Joblit is

A job-search workflow product: **fetch** roles → **triage** them → **tailor** a
CV and cover letter → export PDFs. One user, many Jobs, one Application per
Job.

Two Job/Resume markets remain: `AU` and `CN` (`lib/shared/market.ts`). Market is
derived from the UI Locale cookie and selects the Resume Locale and LaTeX
renderer. CN Jobs, Resume, Chinese LaTeX, and translated UI remain supported,
but CN navigation exposes Resume only. The executable Fetch Pipeline is AU-only;
CN Fetch and the former `GLOBAL` source-adapter selector were retired by
[ADR-0017](../adr/0017-retire-cn-and-global-job-intake.md).

---

## The three pipelines

### 1. Fetch Pipeline — roles in

`FetchRun` is the unit of work. Creation and dispatch are separate steps.

```
POST /api/fetch-runs            → AU FetchRun row (QUEUED)
                                  + strict AU FetchRunConfig v2
POST /api/fetch-runs/[id]/trigger
  └─ market AU → GitHub Actions workflow_dispatch → Python JobSpy
                  → GET  /api/fetch-runs/[id]/config
                  → POST /api/fetch-runs/[id]/commit
                               │
                               ▼
                  lib/server/fetchRuns/fetchRun.ts
                  FRUN → attempt fence → JOBJ
                  → Job + receipt + run projection
```

The asynchronous AU worker reaches the FetchRun module through the
`FETCH_RUN_SECRET`-guarded HTTP adapter. Commands form `fetch-run-commit/v1`,
and the module validates the untrusted wire command, derives the owner and
market from the stored run, and enforces AU-only execution before every
external lifecycle mutation. User cancel,
status-triggered stale recovery, manual stale sweep, and ordered worker commits
cross the same FetchRun interface. Creation,
config, trigger, and commit boundaries reject non-AU execution. The config
reader accepts strict AU v2 plus historical AU v1 only; unknown and retired
market shapes fail closed.

Every executor carries a UUID attempt. `start` records
`executionAttemptId` + `executionLeaseExpiresAt` under `FRUN` (30 minutes for
AU). A same-attempt `start` renews; a different
attempt is blocked until expiry, then may take over. Expiry only makes takeover
eligible: the current attempt remains valid until another `start` actually
replaces it. New `commit` and external `fail` commands must match the current
attempt; a non-terminal commit renews the lease.

`dispatchMeta` in the JSON config is not this fence. Its timestamps and
idempotency key claim the short pre-`start` AU dispatch window. After `start`,
only the relational attempt and lease authorize new execution writes.

Each applied result batch writes a `FetchRunCommitReceipt` in the same
transaction as Jobs, import counters, and any terminal projection. A replay
with the same `(runId, batchKey)` and request hash returns the receipt; different
content conflicts. Batch indexes are ordered and unique per run, and only the
final declared batch may be terminal. The receipt records the applying
`executionAttemptId`; exact receipt replay remains run-scoped after a takeover,
but the result identifies the canonical receipt attempt and does not authorize a
stale attempt to append work or publish auxiliary projections. See ADR-0008.

Stage 1 removed the CN Nowcoder and GLOBAL public-feed/ATS executors and used a
bounded, artifact-aware cleanup to retire their historical FetchRuns and GLOBAL
Jobs. CN Job/Resume data remains. After old instances, legacy rows, orphan
Artifacts, and Blob inventory converged, Stage 2 removed the writer-less
`SourceHealth` and `AtsBoardSource` schema contract in a fail-closed migration.

Import dedupes in three layers — an in-payload `Set`, the `DeletedJobUrl`
tombstone table, and the `@@unique([userId, jobUrl])` constraint. All three key
on `canonicalizeJobUrl` (`lib/shared/canonicalizeJobUrl.ts:59`). See
[data.md](./data.md#the-deletedjoburl-tombstone).

Cancellation and commits linearize on `FRUN`. A cancellation that wins rejects
future batches. A batch that wins commits its Jobs and receipt before
cancellation is evaluated; those rows are not rolled back. A cancelled or
failed run after the first commit is terminal `PARTIAL`, not `FAILED`.

### 2. Triage — which roles are worth applying to

AI fit scoring was retired end to end (ADR-0019): the queue tables, the
`/api/jobs/fit/**` routes, the worker drain, and the Job score columns are
gone. `/api/jobs/bulk-ignore` went with them. Nothing pins their absence —
`test/architecture/legacyApplicationGenerateRoute.test.ts` covers only the
seven retired *generation* paths.
Triage now rests on deterministic signals computed at read or import time:
the JD requirements analysis (`lib/shared/jobExperienceAnalysis`,
`lib/shared/jdTechnicalAnalysis`) extracts hard asks with evidence offsets,
and posting risk (`lib/server/jobs/postingRisk.ts`) flags suspicious ads at
import. No model runs during triage, so the same ad always reads the same way.

Job status is a projection, not the source of truth — ADR-0007. Seven values
are stored so `ApplicationEvent` history stays readable; three are surfaced
(`lib/shared/jobStatus.ts:24`). Deletion is permanent and writes a tombstone;
the reversible path is `NEW → REJECTED`.

### 3. Tailoring — Job + Master Resume Profile → Application

Generation is local-first (ADR-0015): the server issues the prompt and
accepts the output, but never runs a model. Since ADR-0022 there is exactly
one door — manual copy/paste — and it feeds the persisted Application
aggregate and Edit model (ADR-0002).

```
  POST /api/applications/prompt          ← one target, a pure read
  buildApplicationPromptForUser
                          │
  [the user pastes the prompt into any chatbot and pastes the JSON back]
                          │
  POST /api/applications/manual-generate?finalize=false
  parse*Output + Quality Gate
                          │
                 attachEvidenceAndReview
                          │
                   DRAFT Application
                          │
                   Edit phase (accept / reject / edit)
                          │
                   POST /api/applications/[id]/finalize   ← one target
                   render LaTeX → ATS check → Blob → CAS commit
                          │
                   FINAL Application + PDFs
```

All three routes are session-only. `prompt` mints nothing: it used to open a
TailoringRun on every call, which dragged a person's copy/paste through a
receipt probe and an acceptance commit it never needed. `manual-generate`
defaults to `finalize=true` — render and commit `FINAL` in one call — but the
browser always passes `finalize=false`, so the only exercised import path
persists a DRAFT and compiles no PDF.

`AI Content` is the persisted provenance snapshot: the current proposal for
each Application target paired
with the user's decision (ADR-0001). The client may only change `accepted` and
`userEdit`; model output, evidence, review verdicts and hashes stay
server-owned. `evolveApplicationAiContent` treats browser payloads as Edit
commands and owns target preservation, provenance, discard, and review
ordering (`lib/server/applications/applicationAiContentAggregate.ts`).

CV and Cover have independent generation provenance, but evidence, review, and
`aiContentHash` still cover the complete aggregate.

The path enforces the current strict output contract: Resume emits a summary
plus zero to three added latest-experience bullets, while Cover emits only its
three body paragraphs. Existing bullets and skills are composed from the Master
Resume Profile rather than copied through model output. Skill Pack V3
distributes this contract together with the user's active effective rules.

**Document-level publication survives ADR-0022 whole.** `/finalize` publishes
exactly one target per call, and the four Application columns
(`resumeContentHash`, `coverContentHash`, `resumePublishedHash`,
`coverPublishedHash`) plus `transitionApplicationPublication` are pure
Application state — see ADR-0020. What died with the queue is the dual-receipt
fence that used to wrap them. `applicationPublicationReplay` survives too: its
only caller is `/finalize`, where it makes a repeated click a read instead of
another LaTeX compile and upload.

CN has no generation surface: the Generate control is gated `!isCN`
(`JobDetailPanel.tsx:474`), and `/jobs` redirects CN to `/resume` anyway. The
server-side prompt builder already speaks `zh-CN` (locale-aware
`coverWordRange`, `salutationStyle`, date format), so lifting that gate is a
small, separate change.

---

## Trust boundaries

| Boundary           | Mechanism                                                                                                                                                                                                       | Where                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Browser → API      | NextAuth database session                                                                                                                                                                                       | `lib/server/auth/requireSession.ts:17`                                               |
| Fetch worker → API | `FETCH_RUN_SECRET` header, constant-time compare                                                                                                                                                                | `app/api/fetch-runs/[id]/config/route.ts`, `app/api/fetch-runs/[id]/commit/route.ts` |
| Cron → API         | `Authorization: Bearer CRON_SECRET`                                                                                                                                                                             | `app/api/artifacts/reconcile`                                                        |
| Server → internet  | `safeOutboundFetch`                                                                                                                                                                                             | `lib/server/net/safeFetch.ts:396`                                                    |

There is no agent boundary any more. ADR-0022 deleted `withAgentRoute`,
`AgentCredential` and the `jfagent_v1_` credential shape; every route is either
session-only (`withSessionRoute`) or one of the two shared secrets above.
Dropping the table is also the revocation for every credential ever minted.

Every route is guarded. `safeOutboundFetch` enforces HTTPS, a
host allowlist, DNS re-checking on every hop, private-address rejection,
bounded redirects with credential stripping, and a streaming size ceiling.

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` relaxes **transport encryption only**
for a self-hosted renderer without TLS. Every other protection stays enforced.
The render token travels as a header, so on plain HTTP it crosses the network
in the clear — treat TLS in front of the renderer as the actual fix.

---

## Layer shape

```
app/(marketing)  app/(auth)  app/(app)        ← React, next-intl, React Query
                                  │
                             app/api/**        ← 30 route files, 37 handlers
                                  │
                            lib/server/**      ← business logic
                                  │
                    prisma (Neon serverless)   ← 19 models
```

`lib/shared/**` is imported by both sides and is the only place a contract may
live: Zod schemas, the job-status projection, market conversion, URL
canonicalization, and the publication projection. `agentExecutionContract.ts`
survives the Runner's deletion holding a single schema — the browser's
`ManualPromptRequestSchema`.

**Known deviations from this shape**, as of this snapshot:

- Business logic still sits inline in large route handlers such as `finalize`,
  `manual-generate`, `fetch-runs`, and `fetch-runs/[id]/trigger`.
- Artifact persistence is centralized in `commitApplicationArtifact`.
  Non-artifact Auto-save and discard still own route-local lock + CAS
  transactions, but both delegate AI Content semantics to
  `evolveApplicationAiContent`. See
  [backend.md](./backend.md#the-application-artifact-commit-sequence).
- ADR-0010 adds the `ApplicationArtifact` lifecycle seam: durable
  stage/reference/retirement, claim-call-fenced settlement, and a reconciler
  restricted to `applications/`. It is side-effect free unless the default-off
  `ARTIFACT_RECONCILE_ENABLED` kill switch is explicitly enabled. Resume Photos
  remain a separate lifecycle.
- `lib/api/fetchJson.ts` is the intended JSON client seam across Jobs, Guide,
  Fetch status, trending and Tailoring Edit. Binary, streaming and `keepalive`
  requests still use platform `fetch` where that interface does not fit.
- `POST /api/applications/manual-generate` still supports `finalize=true`
  (render + commit `FINAL` in one call). No caller in the repository uses it —
  the browser always passes `finalize=false`. It is a live but unexercised
  branch, not a documented path.

These are recorded because a reader will meet them, not as a plan.

---

## Concurrency

Postgres transaction-scoped advisory locks use named namespaces. The shared
`lib/server/db/advisoryLock.ts` owns all three surviving identities — `FRUN`,
`JOBJ`, `JOBA` — and their explicit order; the specialized Application Event
lock (`JOBC`) remains local to its module. The retired source-health, batch
(`ABAT`) and Tailoring Run (`TLRN`) namespaces have no live owner or schema
object. A lock is the
module's first database effect; composed modules follow the documented order.
Fetch commits always acquire `FRUN` before `JOBJ`, then persist Jobs, the
receipt, counters, and status in that transaction. Application mutation locks
remain sorted by job ID
(`lib/server/applications/applicationMutationLock.ts:16-25`). Full table in
[data.md](./data.md#advisory-locks).

The execution lease is a persisted fencing protocol, not an advisory lock.
`FRUN` serializes ownership changes and cancellation; the UUID attempt is what
rejects a superseded executor after the transaction releases the lock.

Compare-and-swap on the aggregate-wide `Application.aiContentHash` guards
Editor Finalize, Auto-save, and discard. `expectedHash` in, `STALE_WRITE` 409
out. Manual generation does not send an expected hash; it serializes
through the Application advisory lock. A manual single-target import folds
into the latest row and re-reviews the combined aggregate while holding that
lock.

Import idempotency is narrower than it was. The receipt probe that made a
repeated paste replay the earlier verdict went with the TailoringRun table;
what remains is the dialog's own in-flight guard. A DRAFT import compiles no
PDF, so a double submit costs a rewrite of identical content rather than a
duplicate artifact. `/finalize`, where the expensive work is, keeps its own
replay.

Per-target provenance is attribution metadata only. It does not provide
per-target hashes, per-target CAS, or independent target lifecycle state.

---

## Testing

Vitest, jsdom, `pool: "vmThreads"` (the forks pool does not register suites on
Windows in this project — `vitest.config.ts`). 220 test files on disk; the root
run takes all but `tools/deploy/vercel-build.test.mjs`, which uses Node's
built-in test runner.

Coverage thresholds are a **ratchet floor** set just under measured coverage,
not an aspirational gate (`vitest.config.ts:42-46`).

`npm run verify` is the single pre-push command and is now five gates:
typecheck, lint, dependency policy, dead-code gate, tests. The Runner and
Hermes steps went with their code. CI runs that set plus migration replay
gates, the build, and dependency audits.

---

## Where things are

| I want to change…                                                    | Start at                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a Job is imported or deduped                                     | `lib/server/fetchRuns/fetchRunJobIntake.ts`, behind the FetchRun interface                                                                                                                                           |
| How a FetchRun starts, commits, fails, cancels, or recovers stale runs | `lib/server/fetchRuns/fetchRun.ts`, then ADR-0008                                                                                                                                                                    |
| The persisted FetchRun execution contract                            | `lib/shared/schemas/fetchRunConfig.ts`                                                                                                                                                                              |
| What the AI is asked                                                 | `lib/server/ai/applicationPromptBuilder.ts`, `lib/server/applications/applicationPrompt.ts`                                                                                                                         |
| Which AI proposals are allowed through                               | The Quality Gate — `lib/server/applications/manualImportParser.ts:409` `isGroundedAddedBullet`, `:446` `isNonRedundantAddedBullet`                                                                                  |
| How a PDF is produced                                                | `lib/server/latex/`, then `lib/server/latex/compilePdf.ts:69`                                                                                                                                                       |
| What "finalized" means                                               | `app/api/applications/[id]/finalize/route.ts`, `lib/server/applications/applicationAiContentAggregate.ts`, `lib/server/applications/commitApplicationArtifact.ts`, `lib/server/applications/finalizeApplication.ts` |
| How Application Blobs are staged, referenced, retired, or reconciled | `lib/server/artifacts/`, `app/api/artifacts/reconcile/route.ts`, then ADR-0010                                                                                                                                      |
| The jobs list UI                                                     | `app/(app)/jobs/JobsClient.tsx` and `app/(app)/jobs/hooks/`                                                                                                                                                         |
| The Master Resume Profile editor                                     | `components/resume/ResumeContext.tsx`                                                                                                                                                                               |
| A user-facing string                                                 | `messages/en.json` **and** `messages/zh.json` — parity is gated by `test/messagesContract.test.ts`                                                                                                                  |
| How a user gets a prompt and pastes the result back                  | `app/api/applications/prompt/route.ts`, `app/api/applications/manual-generate/route.ts`, then `app/(app)/jobs/hooks/useExternalGenerate.ts`                                                                         |
