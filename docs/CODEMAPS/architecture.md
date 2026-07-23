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

Two markets: `AU` and `CN` (`lib/shared/market.ts:22`). Market is derived from
the UI Locale cookie, and it decides which sources are fetched, which Resume
Locale the LaTeX renderer uses, and which pages appear in the nav
(`components/app-shell/AppNav.tsx:59-70` — CN sees only `/resume` and
`/discover`).

---

## The four pipelines

### 1. Fetch Pipeline — roles in

`FetchRun` is the unit of work. Creation and dispatch are separate steps.

```
POST /api/fetch-runs            → FetchRun row (QUEUED), quota-checked
POST /api/fetch-runs/[id]/trigger
  ├─ market AU     → GitHub Actions workflow_dispatch → Python JobSpy
  │                  → POST /api/admin/import (IMPORT_SECRET)
  │                  → callbacks to /api/fetch-runs/[id]/update (FETCH_RUN_SECRET)
  ├─ market CN     → lib/server/cnFetch/processFetchRun.ts, in-process
  └─ market GLOBAL → lib/server/sources/processGlobalFetchRun.ts, in-process
```

The AU branch is asynchronous and finishes through a worker callback; the other
two complete inside the request and write their own terminal status. The branch
lives in `app/api/fetch-runs/[id]/trigger/route.ts:251-345`.

Import dedupes in three layers — an in-payload `Set`, the `DeletedJobUrl`
tombstone table, and the `@@unique([userId, jobUrl])` constraint. All three key
on `canonicalizeJobUrl` (`lib/shared/canonicalizeJobUrl.ts:59`). See
[data.md](./data.md#the-deletedjoburl-tombstone).

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

Two generation paths converge on one Edit phase (ADR-0002).

```
Path A (Gemini, server-side)      Path B (manual / Local AI)
  buildTailorPrompts                buildApplicationPromptForUser
  callProvider("gemini")            [external LLM runs the prompt]
  parseTailorModelOutput            parse*Output + Quality Gate
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

`AI Content` is the persisted provenance snapshot: every AI proposal paired
with the user's decision (ADR-0001). The client may only change `accepted` and
`userEdit`; model output, evidence, review verdicts and hashes stay
server-owned (`lib/server/applications/canonicalAiContent.ts:38-42`).

### 4. Codex Batch — tailoring without a human

`ApplicationBatch` over `NEW` Jobs. `POST /api/application-batches/[id]/run-once`
is atomic: complete the previous task and claim the next in one call, idempotent
for the same `taskId`. Protocol in `AGENTS.md`.

---

## Trust boundaries

| Boundary | Mechanism | Where |
|---|---|---|
| Browser → API | NextAuth database session | `lib/server/auth/requireSession.ts:17` |
| Extension → API | Bearer token, SHA-256 hash stored | `lib/server/auth/requireExtensionToken.ts:34` |
| JobSpy worker → API | `IMPORT_SECRET` header, constant-time compare | `app/api/admin/import/route.ts` |
| Fetch worker → API | `FETCH_RUN_SECRET` header | `app/api/fetch-runs/[id]/{update,config}` |
| Cron → API | `Authorization: Bearer CRON_SECRET` | `app/api/discover/refresh-daily` |
| Server → internet | `safeOutboundFetch` | `lib/server/net/safeFetch.ts:396` |

Every one of the 68 routes is guarded. `safeOutboundFetch` enforces HTTPS, a
host allowlist, DNS re-checking on every hop, private-address rejection,
bounded redirects with credential stripping, and a streaming size ceiling. One
outbound edge bypasses it: `lib/server/cnFetch/adapters/nowcoder.ts:169`.

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` relaxes **transport encryption only**
for a self-hosted renderer without TLS. Every other protection stays enforced.
The render token travels as a header, so on plain HTTP it crosses the network
in the clear — treat TLS in front of the renderer as the actual fix.

---

## Layer shape

```
app/(marketing)  app/(auth)  app/(app)        ← React, next-intl, React Query
                                  │
                             app/api/**        ← 68 route handlers
                                  │
                            lib/server/**      ← business logic
                                  │
                    prisma (Neon serverless)   ← 28 models
```

`lib/shared/**` is imported by both sides and is the only place a contract may
live: Zod schemas, the job-status projection, market conversion, URL
canonicalization, the Local AI bridge contract.

**Known deviations from this shape**, as of this snapshot:

- Business logic sits inline in the fattest routes — `finalize` (495 lines),
  `manual-generate` (462), `fetch-runs` (454), `fetch-runs/[id]/trigger` (382).
- The Application commit sequence is written three times with three different
  upload-failure semantics. See [backend.md](./backend.md#the-application-commit-sequence).
- `lib/api/fetchJson.ts` is the intended client seam and has three importers
  against 36 hand-rolled `fetch` call sites.
- The Chrome extension cannot import `lib/shared/**` — its tsconfig cannot
  resolve the path — so `localAiBridgeContract.ts` and
  `chrome-extension/src/shared/hermesTypes.ts` are two hand-written parsers for
  one wire format.

These are recorded because a reader will meet them, not as a plan.

---

## Concurrency

Postgres transaction-scoped advisory locks, seven namespaces, all taken as the
first statement of their transaction. Ordering rule: broader lock first, then
Application locks in sorted job-id order
(`lib/server/applications/applicationMutationLock.ts:16-25`). Full table in
[data.md](./data.md#advisory-locks).

Compare-and-swap on `Application.aiContentHash` guards the Edit phase against
lost updates. `expectedHash` in, `STALE_WRITE` 409 out. Present in
`finalize`, `draft` and `discard`; absent from `manual-generate` and
`generateApplicationArtifacts`, which rely on the advisory lock alone.

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
| What the AI is asked | `lib/server/ai/applicationPromptBuilder.ts`, `lib/server/applications/applicationPrompt.ts` |
| Which AI proposals are allowed through | The Quality Gate — `lib/server/applications/manualImportParser.ts:419`, `:450` |
| How a PDF is produced | `lib/server/latex/`, then `lib/server/latex/compilePdf.ts:68` |
| What "finalized" means | `app/api/applications/[id]/finalize/route.ts`, `lib/server/applications/finalizeApplication.ts` |
| The jobs list UI | `app/(app)/jobs/JobsClient.tsx` and `app/(app)/jobs/hooks/` |
| The Master Resume Profile editor | `components/resume/ResumeContext.tsx` |
| A user-facing string | `messages/en.json` **and** `messages/zh.json` — parity is gated by `test/messagesContract.test.ts` |
| The extension ↔ web contract | `lib/shared/localAiBridgeContract.ts` **and** `chrome-extension/src/shared/hermesTypes.ts` |
