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

1. **Job Intake**: `FetchRun` tasks dispatch GitHub Actions (Python JobSpy fetcher) → import via `/api/admin/import` with dedupe on `userId + jobUrl` and tombstone filtering (`DeletedJobUrl`)
2. **Tailoring**: `Job` + `ResumeProfile` → AI prompt (via versioned `PromptRuleTemplate`) → external model or `/api/applications/generate` → import JSON artifact → PDF render via LaTeX external service
3. **Batch (Codex)**: `ApplicationBatch` with `NEW` jobs → atomic claim+generate+import per task via `/api/application-batches/[id]/run-once`
4. **Extension**: Chrome extension authenticates via `/api/ext/auth/token` → reads flat profile → logs field mappings and form submissions for learning auto-fill rules

### Route Groups

- `app/(marketing)/` — Public landing pages, no auth
- `app/(auth)/login/` — Authentication pages
- `app/(app)/` — Protected workspace: `fetch/`, `jobs/`, `resume/`, `automation/`, `discover/`, `extension/`
- `app/api/` — All API routes

### Backend (`lib/server/`)

- `ai/` — Prompt building, Gemini API client, skill pack management, CV/CL quality gates
- `latex/` — LaTeX template rendering (`renderResume.ts` for EN, `renderResumeCN.ts` for CN)
- `applications/` — Resume/cover artifact generation and storage
- `applicationBatches/` — Batch task orchestration (Codex protocol, progress tracking)
- `jobs/` — Job CRUD, filtering, deletion cascade (jobListService, jobDeleteService, jobSearchService)
- `files/` — Vercel Blob operations and PDF filename utilities
- `discover/` — YouTube video pipeline: fetch, cache, refresh
- `cnFetch/` — China job sources: GitHub repos, RSSHub, V2EX adapters
- `api/` — Shared route utilities: `errorResponse`, `rateLimit`, `routeHandler`
- `auth/` — Session middleware: `requireSession`, `requireExtensionToken`
- `prisma.ts` — Prisma singleton with Neon serverless adapter

### Shared (`lib/shared/`)

- `schemas/` — Zod v4 schemas (canonical validation layer for all API boundaries)
- `locales/` — i18n string tables for `en-AU` and `zh-CN`
- `skillsGazetteer` — Canonical skills vocabulary used in prompt quality gates
- `aiPromptDefaults` — Default AI prompt parameters
- `fetchRolePacks.config.json` — Role category definitions
- `canonicalizeJobUrl`, `parseCnSalary`, `fetchExclusionCriteria` — Job normalization helpers

### Prisma Models (18)

Core workflow: `Job`, `FetchRun`, `ApplicationBatch`, `ApplicationBatchTask`, `Application`, `ResumeProfile`, `ActiveResumeProfile`, `PromptRuleTemplate`  
Auth: `User`, `Account`, `Session`, `ExtensionToken`  
Supporting: `DeletedJobUrl` (dedup tombstone), `DailyCheckin`, `FormSubmission`, `FieldMappingRule`, `OnboardingState`, `DiscoverVideoCache`

### Internationalization

Two locales: `en-AU` and `zh-CN` via next-intl. Locale is cookie-based. Resume profiles and LaTeX renderers are locale-specific. `ActiveResumeProfile` stores the active resume per `userId + locale`.

### Authentication

NextAuth v4 with GitHub + Google OAuth, Prisma adapter (database sessions). Sign-in is free, open, and self-service: no invitation or manual approval is required. Session includes `user.id`. Background routes use service-secret boundaries: `/api/admin/import` is an internal JobSpy import route protected by `IMPORT_SECRET`, while fetch-run callbacks use `FETCH_RUN_SECRET`.

### Testing

Tests live alongside source files (`.test.ts`/`.test.tsx`) or in `test/`. Setup file: `test/setup.ts`. Jsdom environment. `test/api/` covers API routes; `test/server/` covers server modules.

### TypeScript

Path alias `@/*` maps to the project root. Import as `@/lib/...`, `@/app/...`, `@/components/...`, etc.

## Environment Variables

Required: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, `IMPORT_SECRET`, `FETCH_RUN_SECRET`, `APP_ENC_KEY` (base64), `LATEX_RENDER_URL`, `LATEX_RENDER_TOKEN`

Optional: `GEMINI_API_KEY`, `GEMINI_MODEL`, `BLOB_READ_WRITE_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `GITHUB_WORKFLOW_FILE`, `JOBLIT_WEB_URL`, `YOUTUBE_API_KEY`, `CRON_SECRET`, `RSSHUB_URL`, `RSSHUB_JOB_ROUTES`, `GITHUB_CN_JOB_REPOS`

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` lets `LATEX_RENDER_URL` be a plain-http
endpoint. `LATEX_RENDER_TOKEN` is sent as a request header, so this puts a
credential on the wire in cleartext — set it only for a self-hosted renderer
that has no TLS yet, and treat putting TLS in front of that renderer as the
actual fix. Every other outbound protection (host allowlist, private-address
blocking, redirect and size limits) stays enforced regardless.

## Prisma Schema Notes

After editing `prisma/schema.prisma`, always run `npx prisma generate`. The client generates to `lib/generated/prisma/`. The Neon serverless adapter is configured in `lib/server/prisma.ts` — do not use the standard Prisma client directly.

## Codex Batch Workflow

The `AGENTS.md` file documents the external orchestration protocol for the Codex batch workflow. Key API: `POST /api/application-batches/[id]/run-once` is atomic (claim next pending task + complete previous task in one call) and idempotent for the same `taskId`.

## Architecture Reference

`docs/CODEMAPS/` contains architecture snapshots: `architecture.md`, `backend.md`, `data.md`, `frontend.md`, `dependencies.md`. Read these before making cross-cutting changes.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `ShousenZHANG/joblit`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repo uses the default mattpocock/skills triage labels, with `bug` and `enhancement` as category labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: one root `CONTEXT.md` and root `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.

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
