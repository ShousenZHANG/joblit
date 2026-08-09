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

## The four pipelines

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
                  lib/server/fetchRuns/fetchRunCommit.ts
                  FRUN → attempt fence → JOBJ
                  → Job + receipt + run projection
```

The asynchronous AU worker reaches the commit module through the
`FETCH_RUN_SECRET`-guarded HTTP adapter. Commands form `fetch-run-commit/v1`,
and the commit module derives the owner and market from the stored run. Creation,
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

Fit scoring runs in the local Runner. The server creates or re-leases one
durable, immutable `FitBatchClaim` (`lib/server/jobs/fitRunService.ts`), the
Runner heartbeats its attempt while scoring through the user's Hermes gateway
(`tools/runner/fitQueue.mjs`), and results come back through
`/api/jobs/fit/batch-import`. The browser enqueues, polls `/api/jobs/fit/status`,
and terminally cancels pending/claimed queue work through
`/api/jobs/fit/cancel`. **No browser surface drives this today** — `useFitScan`
was deleted with the Jobs filter rebuild, and the fit queue is currently reached
only by the Runner. The routes remain; see the pending fit-retirement work.

Each prompt exposes a stable 64-hex issue bound once to the Claim's exact Job
set, Resume snapshot, and prompt receipt. `lib/server/jobs/fitBatchImport.ts`
validates the current attempt and accounts for every Claim item while writing
Job projections, item outcomes, `FitBatchImportReceipt`, and the terminal Claim
atomically. An exact retry reads the receipt first, so a lost response remains
recoverable after lease takeover. `/api/jobs/fit/settlement-status` distinguishes
active, settled, and terminal-without-receipt work before the Runner clears any
local result.

Same-session Hermes starts and repairs use file-backed compare-and-set. A start
reservation also records a transcript cursor plus request hashes; after an
ambiguous start response, output is recovered only from one provable matching
terminal turn. An incomplete tool-call snapshot stays deferred; a completed
tool sequence qualifies only through a later unique terminal `stop` output.
Retryable gateway responses are not submitted twice or projected as model failure.
This is a conservative adapter over unmodified Hermes, not a claim of remote
exactly-once execution (ADR-0016).

**The model emits per-requirement judgements only.** `aggregateFitMatrix`
computes the score deterministically from them
(`prisma/schema.prisma:224-226`). Do not move scoring into the prompt.

Job status is a projection, not the source of truth — ADR-0007. Seven values
are stored so `ApplicationEvent` history stays readable; three are surfaced
(`lib/shared/jobStatus.ts:24`). Deletion is permanent and writes a tombstone;
the reversible path is `NEW → REJECTED`.

### 3. Tailoring — Job + Master Resume Profile → Application

Generation is local-first (ADR-0015): the server issues the prompt and
accepts the output, but never runs a model. One durable path feeds the
persisted Application aggregate and Edit model (ADR-0002).

```
  buildApplicationPromptForUser
  [the user's model runs the prompt — Runner via loopback Hermes, or manual]
  parse*Output + Quality Gate
                          │
                 attachEvidenceAndReview
                          │
                   DRAFT Application
                          │
                   Edit phase (accept / reject / edit)
                          │
                   POST /api/applications/[id]/finalize
                   render LaTeX → ATS check → Blob → CAS commit
                          │
                   FINAL Application + PDFs
```

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

### 4. Codex Batch — tailoring without a human

`ApplicationBatch` over `NEW` Jobs. `POST /api/application-batches/[id]/run-once`
reports only a previous `FAILED`/`SKIPPED` attempt and claims new tasks. Each
task response includes its fencing `attemptId`, stable derived `issueKey`, and
durable `acceptedTargets`/`remainingTargets`. External Codex requests only the
missing target prompts with `source = codex_batch`, `delivery = FINAL`, the
claimed `issueKey`, and the batch/task/attempt binding, then echoes each
response's `promptMeta` and public `tailoringRun` handle through
`manual-generate`. Reclaim preserves the accepted Application half.

Fresh and failed-task retry batches enter through one
`queueApplicationBatch` transaction. It takes the per-user Job mutation lock
before checking active work, selecting Jobs, and creating the exact header/task
set; a partial unique PostgreSQL index independently enforces one `QUEUED` or
`RUNNING` batch per user. Permanent Job deletion first row-locks target Jobs in
stable order, then takes affected ABAT locks, lets task rows cascade, and
reconciles each surviving batch in the same transaction. The row fence closes
the expand-window race with a legacy in-flight task FK insert. A now-empty
active batch becomes `CANCELLED`, not falsely `SUCCEEDED` or `FAILED`.

There is no independent success callback. The final required target is the
point of no return: its transaction commits the Application mutation,
immutable `TailoringRunReceipt`, terminal `TailoringRun`, and
`ApplicationBatchTask = SUCCEEDED` together. Task `PATCH` and `run-once`
completion input therefore accept only `FAILED`/`SKIPPED` with the claimed
`attemptId`. The retired `/execute` server auto-generation route was removed with the
Gemini provider chain (ADR-0015).
For protocol-v1 tasks, the same transaction also writes
`completionAttemptId = executionAttemptId`; a database constraint rejects an
old worker's unreceipted success after a new claim.
Private Hermes `run_*` identifiers stay in the Runner and never enter
Joblit's domain model. Protocol in `AGENTS.md`; durability details in ADR-0009.

While Hermes executes, the Runner polls the Tailoring Run and accepts a
non-terminal response only when its active `{ id, attemptId }` matches the
issued handle. Takeover aborts stale local work. Unknown import outcomes replay
the byte-identical receipt and remain deferred if still unconfirmed; they are
never converted into a false task failure. When no task is claimable but a live
lease remains, `run-once` returns a bounded retry hint and the Runner waits.

Machine-local Hermes state contains only opaque ids, hashes, a repair cursor,
and non-secret operation identity. Startup reconciles it against accepted
target masks before new work. A Hermes `stopping` response is non-terminal, and
an interrupted repair is recovered from one unambiguous session-transcript
response rather than submitted twice.

---

## Trust boundaries

| Boundary           | Mechanism                                                                                                                                                                                                       | Where                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Browser → API      | NextAuth database session                                                                                                                                                                                       | `lib/server/auth/requireSession.ts:17`                                               |
| Agent → API        | `withAgentRoute`: capability-scoped `jfagent_v1_` Bearer credential, or the session cookie when no header is presented; a presented credential never falls back to the cookie. Token hashes are SHA-256 at rest | `lib/server/api/routeHandler.ts`, `lib/server/auth/requireAgentCredential.ts`        |
| Fetch worker → API | `FETCH_RUN_SECRET` header, constant-time compare                                                                                                                                                                | `app/api/fetch-runs/[id]/config/route.ts`, `app/api/fetch-runs/[id]/commit/route.ts` |
| Cron → API         | `Authorization: Bearer CRON_SECRET`                                                                                                                                                                             | `app/api/artifacts/reconcile`                                                        |
| Server → internet  | `safeOutboundFetch`                                                                                                                                                                                             | `lib/server/net/safeFetch.ts:396`                                                    |

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
                             app/api/**        ← 58 route handlers
                                  │
                            lib/server/**      ← business logic
                                  │
                    prisma (Neon serverless)   ← 27 models
```

`lib/shared/**` is imported by both sides and is the only place a contract may
live: Zod schemas, the job-status projection, market conversion, URL
canonicalization, and the versioned Agent execution contract. The Runner stays
repo-import-free and pins the same HTTP shapes in its own Node tests.

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
- `tools/runner/` deliberately imports nothing from the repository. The HTTP
  API is its contract, exactly as for any external agent, so the shapes it
  depends on are pinned by its own tests rather than by shared types.

These are recorded because a reader will meet them, not as a plan.

---

## Concurrency

Postgres transaction-scoped advisory locks use named namespaces. The shared
`lib/server/db/advisoryLock.ts` owns the cross-module `FRUN`, `JOBJ`, and
`JOBA` identities and their explicit order; specialized Fit, Tailoring Run,
and Application Event locks remain local to their modules. The retired
source-health namespace has no live owner or schema object. A lock is the
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
out. Manual and server generation do not send an expected hash; they serialize
through the Application advisory lock. A manual single-target import folds
into the latest row and re-reviews the combined aggregate while holding that
lock.

Per-target provenance is attribution metadata only. It does not provide
per-target hashes, per-target CAS, or independent target lifecycle state.

---

## Testing

Vitest, jsdom, `pool: "vmThreads"` (the forks pool does not register suites on
Windows in this project — `vitest.config.ts`). 248 root test files. The Runner
suites use Node's built-in test runner (`npm run test:runner`).

Coverage thresholds are a **ratchet floor** set just under measured coverage,
not an aspirational gate (`vitest.config.ts:41-46`).

`npm run verify` is the single pre-push command: typecheck, lint, dependency
policy, dead-code gate, and tests. CI runs that set plus the Runner suites, the
build, and dependency audits.

---

## Where things are

| I want to change…                                                    | Start at                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a Job is imported or deduped                                     | `lib/server/jobs/jobImportService.ts`                                                                                                                                                                               |
| How a FetchRun starts, commits, fails, or races cancellation         | `lib/server/fetchRuns/fetchRunCommit.ts`, then ADR-0008                                                                                                                                                             |
| The persisted FetchRun execution contract                            | `lib/shared/schemas/fetchRunConfig.ts`                                                                                                                                                                              |
| What the AI is asked                                                 | `lib/server/ai/applicationPromptBuilder.ts`, `lib/server/applications/applicationPrompt.ts`                                                                                                                         |
| Which AI proposals are allowed through                               | The Quality Gate — `lib/server/applications/manualImportParser.ts:419`, `:450`                                                                                                                                      |
| How a PDF is produced                                                | `lib/server/latex/`, then `lib/server/latex/compilePdf.ts:68`                                                                                                                                                       |
| What "finalized" means                                               | `app/api/applications/[id]/finalize/route.ts`, `lib/server/applications/applicationAiContentAggregate.ts`, `lib/server/applications/commitApplicationArtifact.ts`, `lib/server/applications/finalizeApplication.ts` |
| How Application Blobs are staged, referenced, retired, or reconciled | `lib/server/artifacts/`, `app/api/artifacts/reconcile/route.ts`, then ADR-0010                                                                                                                                      |
| The jobs list UI                                                     | `app/(app)/jobs/JobsClient.tsx` and `app/(app)/jobs/hooks/`                                                                                                                                                         |
| The Master Resume Profile editor                                     | `components/resume/ResumeContext.tsx`                                                                                                                                                                               |
| A user-facing string                                                 | `messages/en.json` **and** `messages/zh.json` — parity is gated by `test/messagesContract.test.ts`                                                                                                                  |
| How the Runner drives a queue                                        | `tools/runner/` and its README, then AGENTS.md                                                                                                                                                                      |
