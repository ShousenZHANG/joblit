# Joblit paths reference

Quick index of the most commonly used locations.

## App routes (pages)

- `app/(app)/jobs/` — Jobs list + detail, filters, manual Add job (AU), Generate CV/CL
- `app/(app)/fetch/` — Create FetchRun (AU: JobSpy/LinkedIn; CN: platforms)
- `app/(app)/resume/` — Master resume editor
- `app/(app)/resume/rules/` — Prompt rules UI (download skill pack, manage templates)
- `app/(auth)/`, `app/(marketing)/` — auth + marketing pages

## API routes

- `GET /api/jobs` — list jobs
- `GET/PATCH/DELETE /api/jobs/[id]` — job detail, status update, delete
- `POST /api/fetch-runs` — create FetchRun
- `POST /api/fetch-runs/[id]/trigger` — dispatch AU or execute CN/GLOBAL adapter
- `GET /api/fetch-runs/[id]/config` — worker pulls run config
- `POST /api/fetch-runs/[id]/commit` — worker sends `fetch-run-commit/v1`
  start, ordered batch commit, and fail commands
- `POST /api/applications/prompt` — build prompt + `promptMeta` + expected schema
- `POST /api/applications/manual-generate` — import strict JSON + render PDFs (requires `promptMeta`)
- `app/api/prompt-rules/*` — prompt templates + skill pack download
- `app/api/application-batches/*` — batch CV/CL workflows

## Server and data

- `lib/shared/canonicalizeJobUrl.ts` — stable URL normalization
- `lib/shared/schemas/fetchRunConfig.ts` — versioned AU/CN/GLOBAL FetchRun config
- `lib/server/fetchRuns/fetchRunCommit.ts` — shared execution/commit boundary,
  receipt replay, lifecycle projection, and `FRUN → JOBJ` lock order
- `lib/server/ai/*` — prompt contract, skill pack builder, schema validation
- `lib/server/latex/*` — LaTeX render for resume/cover
- `prisma/schema.prisma` — DB models

## Fetch workers

- `tools/fetcher/run_jobspy.py` — AU JobSpy runner (GitHub Actions)
- `lib/server/cnFetch/` — CN aggregator (user-triggered, in-process):
  - `adapters/nowcoder.ts`
  - `normalize.ts`, `runCnFetch.ts`, `processFetchRun.ts`
  - Invoked only by `/api/fetch-runs/[id]/trigger`.
  - Retired legacy: `tools/fetcher/run_cn_fetcher.py` + `cn_platforms/*`.
- `lib/server/sources/` — GLOBAL public APIs, ATS boards, health tracking,
  rediscovery, filtering, and user-triggered import.
