# Joblit flows (high signal)

## 1) FetchRun → GitHub Actions → import → Jobs list

1. UI creates FetchRun: `POST /api/fetch-runs` (market AU or CN).
2. UI triggers: `POST /api/fetch-runs/:id/trigger`.
3. Dispatch path depends on market:
   - AU: GitHub Actions `jobspy-fetch.yml` (Python `tools/fetcher/run_jobspy.py`)
   - CN: the authenticated trigger runs the in-process public-source adapters
     via `lib/server/cnFetch/`
   - GLOBAL: the authenticated trigger runs public job APIs and enabled ATS
     boards via `lib/server/sources/`
4. AU worker pulls config: `GET /api/fetch-runs/:id/config` (guarded by secret).
5. AU worker imports jobs: `POST /api/admin/import` (guarded by `x-import-secret`).
   CN and GLOBAL pipelines write through the same normalized import service.
6. Jobs appear in `GET /api/jobs` and the `/jobs` UI.

All fetches are user initiated. There is no scheduled product fetch path.

## 2) External model CV/CL generation (skill pack + strict JSON import)

1. Download skill pack: `GET /api/prompt-rules/skill-pack` (optional `?redact=true`).
2. Build a per-job prompt: `POST /api/applications/prompt` with `{ jobId, target }`.
3. Generate strict JSON in external model using:
   - skill pack prompt templates and rules
   - expected JSON schema returned by the prompt API
4. Import + render PDFs: `POST /api/applications/manual-generate` with:
   - `jobId`, `target`, `modelOutput` (strict JSON string), and **matching** `promptMeta`

Hard rule: never import without `promptMeta`.

