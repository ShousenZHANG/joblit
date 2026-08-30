# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode

# Run a single test file
npx vitest run path/to/test.test.ts

# Database
npx prisma migrate dev    # Apply migrations in dev
npx prisma generate       # Regenerate Prisma client after schema changes
npx prisma studio         # GUI to inspect the database

npm run readme:metrics    # Regenerate README badge counts
npm run deps:policy       # Check dependency policy
```

## Architecture

**Joblit** is a job-search workflow product: fetch roles → triage → tailor resume/cover letter → export PDFs.

### Key Data Flow

1. **Job Intake**: `FetchRun` is AU-only. It persists a strict AU v2 config (with an AU v1 compatibility reader), then dispatches the GitHub Actions JobSpy worker. Results enter `commitFetchRun`, where ordered receipts, Jobs, counters, and terminal state commit atomically with dedupe on `userId + jobUrl` and tombstone filtering (`DeletedJobUrl`). CN Fetch and GLOBAL feed/ATS execution were retired by ADR-0017; CN Jobs, Resume, LaTeX, and translated UI remain product capabilities
2. **Tailoring**: `Job` + `ResumeProfile` → AI prompt (via versioned `PromptRuleTemplate`) → the user's model runs it through the local Codex CLI Runner, or an external result is imported by hand → persisted Application aggregate → target-scoped PDF render via the LaTeX service. The server holds no model key and runs no generation (ADR-0015)
3. **Triage**: AI fit scoring was retired end to end (ADR-0019); deterministic JD requirements analysis is the surviving triage signal.

Tailoring changes two things on a CV and nothing else (ADR-0023). The summary is
regenerated within a 120-350 character window and checked at the import boundary
by `lib/server/ai/summaryLint.ts`: it must name the target role with seniority
words stripped, and it may state no number and no skill the Master Resume
Profile does not already carry. The skills section is chosen by **index
reference** into the candidate's own skill bank — the model returns
`{ group, items }` positions, never a skill name, and an index that does not
resolve against the profile is rejected. Cover returns only its three body
paragraphs. Experience bullets are never AI-written.

AI-added bullets, the evidence ledger and the review gate were deleted with
ADR-0023; a gate that judges generated text is a probabilistic check on a
probabilistic output, and a model that can only return integers cannot
fabricate. Do not reintroduce either. Skill Pack V3 must package the user's
active effective `PromptRuleTemplate`, not defaults. The retired
`/api/applications/generate`, `/api/applications/generate-cover-letter` and
`/api/applications/[id]/preview` routes, and the `/jobs/[id]/tailor` page, must
not be reintroduced.

### Route Groups

- `app/(marketing)/` — Public landing pages, no auth
- `app/(auth)/login/` — Authentication pages
- `app/(app)/` — Protected workspace: `jobs/`, `fetch/`, `resume/`, plus `career/` (a redirect to `/jobs`, ADR-0006). Runner setup is a nav popover, not a page; the retired `/agent` and `/discover` routes must not be reintroduced
- `app/api/` — All API routes

### Backend (`lib/server/`)

- `ai/` — Prompt building, skill pack management, and `summaryLint.ts`, the deterministic gate on generated summaries (ADR-0023). No provider client: generation is local-first (ADR-0015). The fit-scoring modules were deleted (ADR-0019)
- `latex/` — LaTeX template rendering (`renderResume.ts` for EN, `renderResumeCN.ts` for CN)
- `applications/` — Resume/cover artifact generation and storage; `applicationEdit.ts` owns the whole non-artifact edit commit behind two functions
- `jobs/` — Job CRUD, filtering, deletion cascade (jobListService, jobDeleteService, jobSearchService)
- `fetchRuns/` — `fetchRun.ts` owns every durable FetchRun transition (worker commit, user cancel, status read, stale sweep); `fetchRunJobIntake.ts` is its private Job-writing half
- `files/` — Vercel Blob operations and PDF filename utilities
- `discover/` — GitHub trending scrape plus its last-known-good cache, read by the nav trending popover. The YouTube video pipeline and the Discover workspace were deleted; do not reintroduce them
- `api/` — Shared route utilities: `errorResponse`, `rateLimit`, `routeHandler`, plus the typed-error layer (`appError`, `databaseError`)
- `auth/` — Session middleware: `requireSession`, and `constantTimeEqual` for the two shared service secrets
- `artifacts/` — Artifact inventory, claim, and delete reconciliation (ADR-0010)
- `runtimeCapabilities/` — The single reader for paired optional credentials; never serialize what it returns (ADR-0013)
- `net/` — `safeFetch`: host allowlist, private-address blocking, redirect and size limits for every outbound call. Enforced by a TypeScript-AST CI gate, not convention: no other file under `app/api/**` or `lib/server/**` may call `fetch()`
- `security/` — `untrustedOutput.ts`: markdown, TSV and pipeline-URL sanitizers
- `db/` — Advisory-lock helpers and transaction boundaries
- `observability/` — `errorReporter`; Sentry is an optional, uninstalled hook
- `archive/` — `zip.ts`, the ZIP32 builder on the Skill Pack download path
- `prisma.ts` — Prisma singleton with Neon serverless adapter

### Shared (`lib/shared/`)

- `schemas/` — Zod v4 schemas (canonical validation layer for all API boundaries)
- `schemas/fetchRunConfig.ts` — versioned AU FetchRun execution contract and historical AU reader
- `locales/` — per-Resume-Locale prompt parameters (`coverWordRange`, `dateFormat`, `salutationStyle`, `toneRules`). UI string tables live in `messages/en.json` and `messages/zh.json`.
- `skillsGazetteer` — Canonical skills vocabulary used in prompt quality gates
- `aiPromptDefaults` — Default AI prompt parameters
- `fetchRolePacks.config.json` — Role category definitions
- `canonicalizeJobUrl`, `parseCnSalary` — Job normalization helpers

### Prisma Models (17)

- Core workflow: `Job`, `FetchRun`, `Application`, `ResumeProfile`, `ActiveResumeProfile`, `PromptRuleTemplate`
- Provenance: `ApplicationEvent` (immutable ledger, carries company/title snapshots so it outlives the Job)
- Artifact lifecycle (ADR-0010): `ApplicationArtifact`, `ApplicationArtifactInventoryCheckpoint`
- Auth: `User`, `Account`, `Session`
- Fetch execution: `FetchRunCommitReceipt`
- Supporting: `DeletedJobUrl` (dedup tombstone), `DailyCheckin`, `OnboardingState`, `DiscoverCache`

The writer-less tables ADR-0006 deferred (`InterviewPlan`, `StarStory`, `Offer`,
`FollowUpReminder`) and the extension's own (`FieldMappingRule`,
`LocalAiSetting`, `FormSubmission`) were dropped in
`20260731120000_drop_extension_and_career_tables`. Do not reintroduce them; a
future submission ledger should be modelled for the agent path, not revived
from the retired form-filling design.

### Internationalization

Two locales: `en-AU` and `zh-CN` via next-intl. Locale is cookie-based. Resume profiles and LaTeX renderers are locale-specific. `ActiveResumeProfile` stores the active resume per `userId + locale`.

### Authentication

NextAuth v4 with GitHub + Google OAuth, Prisma adapter (database sessions). Sign-in is free, open, and self-service: no invitation or manual approval is required. Session includes `user.id`. The AU worker uses `FETCH_RUN_SECRET` for `/api/fetch-runs/[id]/config` and `/api/fetch-runs/[id]/commit`; the commit module derives tenant identity from the stored run. Every route is session-authenticated; `withAgentRoute` and `AgentCredential` were retired with the Runner (ADR-0022). The retired `/api/admin/import`, `/api/fetch-runs/[id]/update`, `/api/ext/**`, `/api/jobs/fit/**`, `/api/jobs/bulk-ignore`, `/api/agent-tokens`, `/api/agent/presence`, `/api/application-batches/**` and `/api/tailoring-runs/**` routes must not be reintroduced.

### Testing

Tests live alongside source files (`.test.ts`/`.test.tsx`) or in `test/`. Setup file: `test/setup.ts`. Jsdom environment. `test/api/` covers API routes; `test/server/` covers server modules.

### TypeScript

Path alias `@/*` maps to the project root. Import as `@/lib/...`, `@/app/...`, `@/components/...`, etc.

## Environment Variables

Required for the running app: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, `FETCH_RUN_SECRET`, `LATEX_RENDER_URL`, `LATEX_RENDER_TOKEN`

Migration connection: production must resolve an unpooled endpoint from `DIRECT_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, or the verified Neon `-pooler` host mapping. `DATABASE_URL` remains pooled for the serverless runtime.

Optional integrations: `BLOB_READ_WRITE_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `GITHUB_WORKFLOW_FILE`, `GITHUB_REF`, `JOBLIT_WEB_URL`, `CRON_SECRET`, `ARTIFACT_RECONCILE_SECRET`, `ARTIFACT_RECONCILE_ENABLED`, `LATEX_RENDER_ALLOW_INSECURE_HTTP`, `APPLICATION_BATCH_TASK_STALE_MS`

Application modules consume optional integrations through
`lib/server/runtimeCapabilities`, not by assembling environment-variable
pairs or parsing feature flags themselves. Keep paired credentials and
enabled/disabled/invalid semantics centralized there; never serialize the
returned secret-bearing configuration.

`DIRECT_URL` is only needed when the integration does not provide an unpooled
URL and the pooled provider has no verified mapping. Migrations read
`DIRECT_URL`, then `DATABASE_URL_UNPOOLED`, then
`POSTGRES_URL_NON_POOLING`. If only a standard `*.neon.tech` `-pooler` URL is
present, Joblit derives the documented matching direct hostname; it does not
guess for other providers.

It is the **unpooled** database endpoint, used only by
`prisma migrate deploy`. Migrate serialises itself with a session-scoped
advisory lock; a transaction-mode pooler hands each statement to a different
backend, so migrate never sees its own lock and the deploy dies after ten
seconds with `Timed out trying to acquire a postgres advisory lock (SELECT
pg_advisory_lock(72707369))` — followed by a misleading "make sure your
database server is running". On Neon this is the same URL as `DATABASE_URL`
without the `-pooler` host suffix. `DATABASE_URL` stays pooled: that is what
the serverless runtime wants, and the app's own locks are transaction-scoped.

`tools/deploy/vercel-build.mjs` refuses to start a production migration when
the resolved URL still looks pooled after that verified mapping, so unknown
providers fail with the cause named rather than as a lock timeout.

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` lets `LATEX_RENDER_URL` be a plain-http
endpoint. `LATEX_RENDER_TOKEN` is sent as a request header, so this puts a
credential on the wire in cleartext — set it only for a self-hosted renderer
that has no TLS yet, and treat putting TLS in front of that renderer as the
actual fix. Every other outbound protection (host allowlist, private-address
blocking, redirect and size limits) stays enforced regardless.

## Prisma Schema Notes

After editing `prisma/schema.prisma`, always run `npx prisma generate`. The client generates to `lib/generated/prisma/`. The Neon serverless adapter is configured in `lib/server/prisma.ts` — do not use the standard Prisma client directly.

FetchRun execution follows ADR-0008. Preserve the `FRUN → JOBJ` advisory-lock
order, keep network I/O outside the commit transaction, and route AU worker
results through `commitFetchRun`. Reject non-AU execution. `PARTIAL` is terminal and means some
work may already be receipt-backed; cancellation never rolls those Jobs back.

## Tailoring Workflow

Generation runs on the operator's machine through the local sidecar
(`tools/tailor/serve.mjs`, ADR-0024) and the dialog drives the whole chain from
one button: the sidecar generates, `POST /api/applications/manual-generate`
imports the JSON as a DRAFT, and `POST /api/applications/:id/finalize`
publishes that target to PDF. `PATCH /api/applications/:id/draft` autosaves
review edits. Every route is session-authenticated; the server still holds no
model credential and calls no model (ADR-0015).

The copy-prompt/paste-result UI was deleted with the one-click chain — there is
no paste box, no prompt preview and no skill-pack download in the dialog, and
the import sends no `promptMeta` because the sidecar builds its own prompt from
the live profile rather than replaying an issued one. `POST
/api/applications/prompt` still serves the skill pack and Claude Code path; it
has no caller in the dialog. The dialog
(`app/(app)/jobs/components/tailoring/TailorDialog.tsx`) is one button plus two
phases, Review and Publish.

The locale the sidecar generates against must be the one the import resolves
the profile with — `marketStringToResumeLocale(job.market)`. Skills are chosen
by index into the candidate's bank, so a mismatched locale selects against the
wrong bank and can publish skills the candidate never picked.

Finalize is the only thing that renders a PDF — there is no tailoring preview
(ADR-0023). The local Runner, the Application Batch queue and the TailoringRun
receipt ledger were deleted.

## Architecture Reference

`docs/CODEMAPS/` contains architecture snapshots: `architecture.md`, `backend.md`, `data.md`, `frontend.md`, `dependencies.md`. Read these before making cross-cutting changes.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `ShousenZHANG/joblit`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repo uses the default mattpocock/skills triage labels, with `bug` and
`enhancement` as category labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: one root `CONTEXT.md` and root `docs/adr/` for
architectural decisions. See `docs/agents/domain.md`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
