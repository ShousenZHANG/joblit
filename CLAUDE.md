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

1. **Job Intake**: `FetchRun` tasks persist a strict market-specific config, then dispatch the AU GitHub Actions worker or run CN/GLOBAL adapters in-process. `executeInlineFetchRun` owns the lifecycle for both inline markets; discovery adapters only return a terminal plan. All results enter `commitFetchRun`, where ordered receipts, Jobs, counters, and terminal state commit atomically with dedupe on `userId + jobUrl` and tombstone filtering (`DeletedJobUrl`)
2. **Tailoring**: `Job` + `ResumeProfile` → AI prompt (via versioned `PromptRuleTemplate`) → external model imported through `/api/applications/manual-generate`, or receipt-backed server batch generation through `executeServerBatchTailoringTask` → persisted Application aggregate → PDF render via LaTeX external service
3. **Batch**: External Codex atomically completes/claims tasks through `/api/application-batches/[id]/run-once` and persists output through `manual-generate`; feature-gated server auto-execute uses `/execute` → `executeServerBatchTailoringTask`. That interface requires Batch, task, issue, and attempt identity and commits with an Application content-hash CAS.
4. **Runner**: The local Runner (`tools/runner/`) authenticates with an agent token, drains the fit queue and the active tailoring batch, and calls the user's Hermes gateway over loopback. It imports no repository code — the HTTP API is the contract, same as for Codex. See ADR-0014.

Current tailoring output is delta-only: Resume returns `cvSummary` plus zero to
three `latestExperience.addedBullets`; Cover returns only its three body
paragraphs. Existing bullets and skills remain owned by `ResumeProfile`. Skill
Pack V3 must package the user's active effective `PromptRuleTemplate`, not
defaults. The retired `/api/applications/generate` and
`/api/applications/generate-cover-letter` session routes must not be
reintroduced.

### Route Groups

- `app/(marketing)/` — Public landing pages, no auth
- `app/(auth)/login/` — Authentication pages
- `app/(app)/` — Protected workspace: `jobs/`, `fetch/`, `resume/`, `discover/`, `agent/`, plus `career/` (a redirect to `/jobs`, ADR-0006)
- `app/api/` — All API routes

### Backend (`lib/server/`)

- `ai/` — Prompt building, Gemini API client, skill pack management, CV/CL quality gates
- `latex/` — LaTeX template rendering (`renderResume.ts` for EN, `renderResumeCN.ts` for CN)
- `applications/` — Resume/cover artifact generation and storage
- `applicationBatches/` — Batch task orchestration (Codex protocol, progress tracking)
- `jobs/` — Job CRUD, filtering, deletion cascade (jobListService, jobDeleteService, jobSearchService)
- `fetchRuns/` — FetchRun quota, unified inline executor, lifecycle lock, and the shared `fetch-run-commit/v1` transaction boundary
- `files/` — Vercel Blob operations and PDF filename utilities
- `discover/` — YouTube video pipeline: fetch, cache, refresh
- `cnFetch/` — China Fetch Pipeline and the Nowcoder adapter
- `api/` — Shared route utilities: `errorResponse`, `rateLimit`, `routeHandler`
- `auth/` — Session middleware: `requireSession`, `requireExtensionToken` (the agent-token validator; the model keeps its original name)
- `prisma.ts` — Prisma singleton with Neon serverless adapter

### Shared (`lib/shared/`)

- `schemas/` — Zod v4 schemas (canonical validation layer for all API boundaries)
- `schemas/fetchRunConfig.ts` — versioned AU/CN/GLOBAL FetchRun execution contract and legacy reader
- `locales/` — per-Resume-Locale prompt parameters (`coverWordRange`, `dateFormat`, `salutationStyle`, `toneRules`). UI string tables live in `messages/en.json` and `messages/zh.json`.
- `skillsGazetteer` — Canonical skills vocabulary used in prompt quality gates
- `aiPromptDefaults` — Default AI prompt parameters
- `fetchRolePacks.config.json` — Role category definitions
- `canonicalizeJobUrl`, `parseCnSalary`, `fetchExclusionCriteria` — Job normalization helpers

### Prisma Models (33)

Core workflow: `Job`, `FetchRun`, `ApplicationBatch`, `ApplicationBatchTask`, `Application`, `ResumeProfile`, `ActiveResumeProfile`, `PromptRuleTemplate`  
Provenance: `ApplicationEvent` (immutable ledger, carries company/title snapshots so it outlives the Job), `EvidenceSnapshot`, `ClaimEvidence`  
Tailoring acceptance (ADR-0009): `TailoringRun`, `TailoringRunReceipt`  
Artifact lifecycle (ADR-0010): `ApplicationArtifact`, `ApplicationArtifactInventoryCheckpoint`  
Auth: `User`, `Account`, `Session`, `ExtensionToken`  
Fetch execution and sources: `FetchRunCommitReceipt`, `SourceHealth`, `AtsBoardSource`
Supporting: `DeletedJobUrl` (dedup tombstone), `DailyCheckin`, `FormSubmission` (the ledger a future agent submission path writes to), `OnboardingState`, `DiscoverVideoCache`  
Retained without writers after the extension was removed (ADR-0014): `FieldMappingRule`, `LocalAiSetting`  
Retained without writers pending a retention migration (ADR-0006): `InterviewPlan`, `StarStory`, `Offer`, `FollowUpReminder`

### Internationalization

Two locales: `en-AU` and `zh-CN` via next-intl. Locale is cookie-based. Resume profiles and LaTeX renderers are locale-specific. `ActiveResumeProfile` stores the active resume per `userId + locale`.

### Authentication

NextAuth v4 with GitHub + Google OAuth, Prisma adapter (database sessions). Sign-in is free, open, and self-service: no invitation or manual approval is required. Session includes `user.id`. Agent tokens (`ExtensionToken`, issued at `/agent`) authenticate the Runner and any external agent through `withAgentRoute`, which accepts a Bearer token or a session cookie; a presented token never falls back to the cookie, so revocation is immediate. See AGENTS.md. The AU worker uses `FETCH_RUN_SECRET` for `/api/fetch-runs/[id]/config` and `/api/fetch-runs/[id]/commit`; the commit module derives tenant identity from the stored run. The retired `/api/admin/import`, `/api/fetch-runs/[id]/update`, and `/api/ext/**` routes must not be reintroduced.

### Testing

Tests live alongside source files (`.test.ts`/`.test.tsx`) or in `test/`. Setup file: `test/setup.ts`. Jsdom environment. `test/api/` covers API routes; `test/server/` covers server modules.

### TypeScript

Path alias `@/*` maps to the project root. Import as `@/lib/...`, `@/app/...`, `@/components/...`, etc.

## Environment Variables

Required: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, `FETCH_RUN_SECRET`, `APP_ENC_KEY` (base64), `LATEX_RENDER_URL`, `LATEX_RENDER_TOKEN`

Optional: `DIRECT_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `BLOB_READ_WRITE_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `GITHUB_WORKFLOW_FILE`, `GITHUB_REF`, `ENABLE_BATCH_EXECUTE_AUTOGEN`, `JOBLIT_ATS_BOARDS_JSON`, `JOBLIT_WEB_URL`, `YOUTUBE_API_KEY`, `CRON_SECRET`, `ARTIFACT_RECONCILE_SECRET`, `ARTIFACT_RECONCILE_ENABLED`, `RSSHUB_URL`, `RSSHUB_JOB_ROUTES`, `GITHUB_CN_JOB_REPOS`

Application modules consume optional integrations through
`lib/server/runtimeCapabilities`, not by assembling environment-variable
pairs or parsing feature flags themselves. Keep paired credentials and
enabled/disabled/invalid semantics centralized there; never serialize the
returned secret-bearing configuration.

`DIRECT_URL` is only needed when the database is wired by hand: the Neon and
Vercel Postgres integrations already inject an unpooled URL, and migrations
read `DIRECT_URL`, then `DATABASE_URL_UNPOOLED`, then
`POSTGRES_URL_NON_POOLING`, before falling back to `DATABASE_URL`.

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
the resolved URL still looks pooled, so this fails with the cause named rather
than as a lock timeout.

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` lets `LATEX_RENDER_URL` be a plain-http
endpoint. `LATEX_RENDER_TOKEN` is sent as a request header, so this puts a
credential on the wire in cleartext — set it only for a self-hosted renderer
that has no TLS yet, and treat putting TLS in front of that renderer as the
actual fix. Every other outbound protection (host allowlist, private-address
blocking, redirect and size limits) stays enforced regardless.

## Prisma Schema Notes

After editing `prisma/schema.prisma`, always run `npx prisma generate`. The client generates to `lib/generated/prisma/`. The Neon serverless adapter is configured in `lib/server/prisma.ts` — do not use the standard Prisma client directly.

FetchRun execution follows ADR-0008. Preserve the `FRUN → JOBJ` advisory-lock
order, keep network I/O outside the commit transaction, and route AU, CN, and
GLOBAL results through `commitFetchRun`. `PARTIAL` is terminal and means some
work may already be receipt-backed; cancellation never rolls those Jobs back.

## Codex Batch Workflow

The `AGENTS.md` file documents the external orchestration protocol for the Codex batch workflow. Key API: `POST /api/application-batches/[id]/run-once` is atomic (claim next pending task + complete previous task in one call) and idempotent for the same `taskId`.

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
