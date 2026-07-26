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

Two UI and Resume Markets: `AU` and `CN` (`lib/shared/market.ts:22`). Market is
derived from the UI Locale cookie, and it decides which Resume Locale the LaTeX
renderer uses and which pages appear in the nav
(`components/app-shell/AppNav.tsx:59-70` — CN sees only `/resume` and
`/discover`). The Fetch Pipeline additionally uses `GLOBAL` as a source-adapter
selector; it is not a third UI or Resume Market.

---

## The four pipelines

### 1. Fetch Pipeline — roles in

`FetchRun` is the unit of work. Creation and dispatch are separate steps.

```
POST /api/fetch-runs            → FetchRun row (QUEUED)
                                  + versioned FetchRunConfig v1
POST /api/fetch-runs/[id]/trigger
  ├─ market AU     → GitHub Actions workflow_dispatch → Python JobSpy
  │                  → GET  /api/fetch-runs/[id]/config
  │                  → POST /api/fetch-runs/[id]/commit
  ├─ market CN     → lib/server/cnFetch/processFetchRun.ts, in-process
  └─ market GLOBAL → lib/server/sources/processGlobalFetchRun.ts, in-process
                               │
                               ▼
                  lib/server/fetchRuns/fetchRunCommit.ts
                  FRUN → attempt fence → JOBJ
                  → Job + receipt + run projection
```

The AU branch is asynchronous and reaches the commit module through the
`FETCH_RUN_SECRET`-guarded HTTP adapter. CN and GLOBAL call the same module
directly. `start`, ordered `commit`, and `fail` commands form
`fetch-run-commit/v1`; adapters finish network discovery before entering it.
The module derives the owner and market from the stored run.

Every executor carries a UUID attempt. `start` records
`executionAttemptId` + `executionLeaseExpiresAt` under `FRUN` (90 seconds for
inline CN/GLOBAL, 30 minutes for AU). A same-attempt `start` renews; a different
attempt is blocked until expiry, then may take over. Expiry only makes takeover
eligible: the current attempt remains valid until another `start` actually
replaces it. New `commit` and external `fail` commands must match the current
attempt; a non-terminal commit renews the lease.

`dispatchMeta` in the JSON config is not this fence. Its timestamps and
idempotency key claim the short pre-`start` dispatch window. For a rolling
upgrade, they also suppress overlap on RUNNING inline rows whose relational
`executionAttemptId` is still null. After `start`, only the relational attempt
and lease authorize new execution writes.

Each applied result batch writes a `FetchRunCommitReceipt` in the same
transaction as Jobs, import counters, and any terminal projection. A replay
with the same `(runId, batchKey)` and request hash returns the receipt; different
content conflicts. Batch indexes are ordered and unique per run, and only the
final declared batch may be terminal. The receipt records the applying
`executionAttemptId`; exact receipt replay remains run-scoped after a takeover,
but the result identifies the canonical receipt attempt and does not authorize a
stale attempt to append work or publish auxiliary projections. See ADR-0008.

Historical GLOBAL rows containing only `sources` normalize to
`queryMode: "source-only"` without synthesizing title or query fields. This
compatibility mode is restricted to explicitly named sources and skips only
role matching. Invalid versioned rows still fail closed.

Inline client recovery observes the same run through one lease interval and
retries that run ID once. Lease loss is a supersession/handoff, not a user
cancellation. GLOBAL source-health and Job-liveness projections run only after
the fenced terminal command, only for its canonical result attempt. Both stores
reject equal or older discovery timestamps, so neither a superseded executor nor
an older cross-run snapshot can overwrite newer observations.

Import dedupes in three layers — an in-payload `Set`, the `DeletedJobUrl`
tombstone table, and the `@@unique([userId, jobUrl])` constraint. All three key
on `canonicalizeJobUrl` (`lib/shared/canonicalizeJobUrl.ts:59`). See
[data.md](./data.md#the-deletedjoburl-tombstone).

Cancellation and commits linearize on `FRUN`. A cancellation that wins rejects
future batches. A batch that wins commits its Jobs and receipt before
cancellation is evaluated; those rows are not rolled back. A cancelled or
failed run after the first commit is terminal `PARTIAL`, not `FAILED`.

### 2. Triage — which roles are worth applying to

Fit scoring runs through the browser extension's local AI. The server leases
batches (`lib/server/jobs/fitRunService.ts:262`), the client pumps them through
the bridge (`app/(app)/jobs/hooks/useFitScan.ts`), and results come back via
`/api/jobs/fit/batch-import`.

**The model emits per-requirement judgements only.** `aggregateFitMatrix`
computes the score deterministically from them
(`prisma/schema.prisma:224-226`). Do not move scoring into the prompt.

Job status is a projection, not the source of truth — ADR-0007. Seven values
are stored so `ApplicationEvent` history stays readable; three are surfaced
(`lib/shared/jobStatus.ts:24`). Deletion is permanent and writes a tombstone;
the reversible path is `NEW → REJECTED`.

### 3. Tailoring — Job + Master Resume Profile → Application

Two durable generation paths converge on one persisted Application aggregate
and Edit model (ADR-0002).

```
Path A (server auto-execute)     Path B (manual / Local AI)
  generateApplicationArtifacts     buildApplicationPromptForUser
  callProvider("gemini")            [external LLM runs the prompt]
  acceptApplicationGeneration      parse*Output + Quality Gate
        │                                 │
        └────────► attachEvidenceAndReview ◄────────┘
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

Both paths share the current strict output contract: Resume emits a summary
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

There is no independent success callback. The final required target is the
point of no return: its transaction commits the Application mutation,
immutable `TailoringRunReceipt`, terminal `TailoringRun`, and
`ApplicationBatchTask = SUCCEEDED` together. Task `PATCH` and `run-once`
completion input therefore accept only `FAILED`/`SKIPPED` with the claimed
`attemptId`. The separate, feature-gated `/execute` route invokes
`generateApplicationArtifactsForJob` through the same acceptance boundary.
For protocol-v1 tasks, the same transaction also writes
`completionAttemptId = executionAttemptId`; a database constraint rejects an
old worker's unreceipted success after a new claim.
Private Hermes `run_*` identifiers stay in the extension and never enter
Joblit's domain model. Protocol in `AGENTS.md`; durability details in ADR-0009.

---

## Trust boundaries

| Boundary | Mechanism | Where |
|---|---|---|
| Browser → API | NextAuth database session | `lib/server/auth/requireSession.ts:17` |
| Extension → API | Bearer token, SHA-256 hash stored | `lib/server/auth/requireExtensionToken.ts:34` |
| Fetch worker → API | `FETCH_RUN_SECRET` header, constant-time compare | `app/api/fetch-runs/[id]/{config,commit}` |
| Cron → API | `Authorization: Bearer CRON_SECRET` | `app/api/discover/refresh-daily` |
| Server → internet | `safeOutboundFetch` | `lib/server/net/safeFetch.ts:396` |

Every route is guarded. `safeOutboundFetch` enforces HTTPS, a
host allowlist, DNS re-checking on every hop, private-address rejection,
bounded redirects with credential stripping, and a streaming size ceiling.
Nowcoder also uses this gateway in production; its injectable `fetchImpl` is a
test adapter, not a production network path.

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` relaxes **transport encryption only**
for a self-hosted renderer without TLS. Every other protection stays enforced.
The render token travels as a header, so on plain HTTP it crosses the network
in the clear — treat TLS in front of the renderer as the actual fix.

---

## Layer shape

```
app/(marketing)  app/(auth)  app/(app)        ← React, next-intl, React Query
                                  │
                             app/api/**        ← 69 route handlers
                                  │
                            lib/server/**      ← business logic
                                  │
                    prisma (Neon serverless)   ← 33 models
```

`lib/shared/**` is imported by both sides and is the only place a contract may
live: Zod schemas, the job-status projection, market conversion, URL
canonicalization, the Local AI bridge contract.

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
- `lib/api/fetchJson.ts` is the intended client seam and has three importers
  against 36 hand-rolled `fetch` call sites.
- The Chrome extension cannot import `lib/shared/**` — its tsconfig cannot
  resolve the path — so `localAiBridgeContract.ts` and
  `chrome-extension/src/shared/hermesTypes.ts` are two hand-written parsers for
  one wire format.

These are recorded because a reader will meet them, not as a plan.

---

## Concurrency

Postgres transaction-scoped advisory locks use seven namespaces. A lock is the
module's first database effect; composed modules follow an explicit order.
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
Windows in this project — `vitest.config.ts:56-58`). 227 root test files, plus
42 in the extension under its own config.

Coverage thresholds are a **ratchet floor** set just under measured coverage,
not an aspirational gate (`vitest.config.ts:41-46`).

`npm run verify` is the single pre-push command: typecheck, lint, dependency
policy, dead-code gate, root tests, extension typecheck, extension tests. CI
runs that set plus the builds and dependency audits.

---

## Where things are

| I want to change… | Start at |
|---|---|
| How a Job is imported or deduped | `lib/server/jobs/jobImportService.ts` |
| How a FetchRun starts, commits, fails, or races cancellation | `lib/server/fetchRuns/fetchRunCommit.ts`, then ADR-0008 |
| The persisted FetchRun execution contract | `lib/shared/schemas/fetchRunConfig.ts` |
| What the AI is asked | `lib/server/ai/applicationPromptBuilder.ts`, `lib/server/applications/applicationPrompt.ts` |
| Which AI proposals are allowed through | The Quality Gate — `lib/server/applications/manualImportParser.ts:419`, `:450` |
| How a PDF is produced | `lib/server/latex/`, then `lib/server/latex/compilePdf.ts:68` |
| What "finalized" means | `app/api/applications/[id]/finalize/route.ts`, `lib/server/applications/applicationAiContentAggregate.ts`, `lib/server/applications/commitApplicationArtifact.ts`, `lib/server/applications/finalizeApplication.ts` |
| How Application Blobs are staged, referenced, retired, or reconciled | `lib/server/artifacts/`, `app/api/artifacts/reconcile/route.ts`, then ADR-0010 |
| The jobs list UI | `app/(app)/jobs/JobsClient.tsx` and `app/(app)/jobs/hooks/` |
| The Master Resume Profile editor | `components/resume/ResumeContext.tsx` |
| A user-facing string | `messages/en.json` **and** `messages/zh.json` — parity is gated by `test/messagesContract.test.ts` |
| The extension ↔ web contract | `lib/shared/localAiBridgeContract.ts` **and** `chrome-extension/src/shared/hermesTypes.ts` |
