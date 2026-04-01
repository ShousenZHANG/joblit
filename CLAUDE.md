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

**Jobflow** is a job-search workflow product: fetch roles → triage → tailor resume/cover letter → export PDFs.

### Key Data Flow

1. **Job Intake**: `FetchRun` tasks dispatch GitHub Actions (Python JobSpy fetcher) → import via `/api/admin/import` with dedupe on `userId + jobUrl` and tombstone filtering (`DeletedJobUrl`)
2. **Tailoring**: `Job` + `ResumeProfile` → AI prompt (via versioned `PromptRuleTemplate`) → external model or `/api/applications/generate` → import JSON artifact → PDF render via LaTeX external service
3. **Batch (Codex)**: `ApplicationBatch` with `NEW` jobs → atomic claim+generate+import per task via `/api/application-batches/[id]/run-once`

### Route Groups

- `app/(marketing)/` — Public landing pages, no auth
- `app/(auth)/login/` — Authentication pages
- `app/(app)/` — Protected workspace: `fetch/`, `jobs/`, `resume/`, `automation/`
- `app/api/` — All API routes

### Backend (`lib/server/`)

- `ai/` — Prompt building, Gemini API client, skill pack management
- `latex/` — LaTeX template rendering (`renderResume.ts` for EN, `renderResumeCN.ts` for CN)
- `applications/` — Resume/cover artifact generation and storage
- `applicationBatches/` — Batch task orchestration
- `files/` — Vercel Blob operations and PDF filename utilities
- `prisma.ts` — Prisma singleton with Neon serverless adapter

### Shared (`lib/shared/`)

- `schemas/` — Zod v4 schemas (the canonical validation layer)
- `fetchRolePacks.config.json` — Role category definitions

### Internationalization

Two locales: `en-AU` and `zh-CN` via next-intl. Locale is cookie-based. Resume profiles and LaTeX renderers are locale-specific. `ActiveResumeProfile` stores the active resume per `userId + locale`.

### Authentication

NextAuth v4 with GitHub + Google OAuth, Prisma adapter (database sessions). Session includes `user.id`. Protected API routes use `IMPORT_SECRET` or `FETCH_RUN_SECRET` for background job authorization.

### Testing

Tests live alongside source files (`.test.ts`/`.test.tsx`) or in `test/`. Setup file: `test/setup.ts`. Jsdom environment.

## Environment Variables

Required: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, `IMPORT_SECRET`, `FETCH_RUN_SECRET`, `APP_ENC_KEY` (base64), `LATEX_RENDER_URL`, `LATEX_RENDER_TOKEN`

Optional: `GEMINI_API_KEY`, `GEMINI_MODEL`, `BLOB_READ_WRITE_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `GITHUB_WORKFLOW_FILE`, `JOBFLOW_WEB_URL`

## Prisma Schema Notes

After editing `prisma/schema.prisma`, always run `npx prisma generate`. The client generates to `lib/generated/prisma/`. The Neon serverless adapter is configured in `lib/server/prisma.ts` — do not use the standard Prisma client directly.

## Codex Batch Workflow

The `AGENTS.md` file documents the external orchestration protocol for the Codex batch workflow. Key API: `POST /api/application-batches/[id]/run-once` is atomic (claim next pending task + complete previous task in one call) and idempotent for the same `taskId`.

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
