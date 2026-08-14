# Joblit paths reference

Quick index of the most commonly used locations.

## App routes (pages)

- `app/(app)/jobs/` — Jobs list + detail, filters, manual Add job (AU), Generate CV/CL
- `app/(app)/fetch/` — Create an AU FetchRun (JobSpy/LinkedIn)
- `app/(app)/resume/` — Master resume editor
- `app/(app)/resume/rules/` — Prompt rules UI (download skill pack, manage templates)
- `app/(auth)/`, `app/(marketing)/` — auth + marketing pages

## API routes

- `GET /api/jobs` — list jobs
- `GET/PATCH/DELETE /api/jobs/[id]` — job detail, status update, delete
- `POST /api/fetch-runs` — create FetchRun
- `POST /api/fetch-runs/[id]/trigger` — dispatch the AU JobSpy worker
- `GET /api/fetch-runs/[id]/config` — worker pulls run config
- `POST /api/fetch-runs/[id]/commit` — worker sends `fetch-run-commit/v1`
  start, ordered batch commit, and fail commands
- `POST /api/applications/prompt` — build prompt + `promptMeta` + expected schema
- `POST /api/applications/manual-generate` — import strict JSON + render PDFs (requires `promptMeta`)
- `app/api/prompt-rules/*` — prompt templates + skill pack download
- `app/api/application-batches/*` — batch CV/CL workflows

## Server and data

- `lib/shared/canonicalizeJobUrl.ts` — stable URL normalization
- `lib/shared/schemas/fetchRunConfig.ts` — strict AU v2 config plus historical AU v1 reader; non-AU fails closed
- `lib/server/fetchRuns/fetchRun.ts` — FetchRun interface for worker commits,
  owned cancel/status, stale recovery, receipt replay, and `FRUN → JOBJ`
- `lib/server/fetchRuns/fetchRunJobIntake.ts` — private Job normalization,
  tombstone/dedupe, risk/liveness, and persistence implementation
- `lib/server/ai/*` — prompt contract, skill pack builder, schema validation
- `lib/server/latex/*` — LaTeX render for resume/cover
- `prisma/schema.prisma` — DB models

## Fetch workers

- `tools/fetcher/run_jobspy.py` — AU JobSpy runner (GitHub Actions)

## Retired intake boundary

- `lib/server/cnFetch/` and `lib/server/sources/` are retired and absent; do not recreate them.
- The one-time cleanup boundary was removed after the production readiness
  gate converged; do not rebuild it as a permanent product subsystem.
- `prisma/migrations/20260809154500_drop_retired_source_tables/` — fail-closed
  contraction of the retired source registry after the production readiness gate.
- `prisma/migrations/20260809161000_verify_post_retirement_inventory/` —
  deployment fence proving the final Blob inventory ran after contraction.
- `docs/adr/0017-retire-cn-and-global-job-intake.md` — decision and rollout order.
