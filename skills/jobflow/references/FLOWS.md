# Joblit flows (high signal)

## 1) FetchRun → discovery → receipt-backed commit → Jobs list

1. UI creates FetchRun: `POST /api/fetch-runs` (market AU, CN, or GLOBAL).
   AU rows store strict `FetchRunConfig` v2 with the immutable recall policy;
   CN and GLOBAL rows remain strict v1.
2. UI triggers: `POST /api/fetch-runs/:id/trigger`.
3. Dispatch path depends on market:
   - AU: GitHub Actions `jobspy-fetch.yml` (Python `tools/fetcher/run_jobspy.py`)
   - CN: the authenticated trigger runs the in-process public-source adapters
     via `lib/server/cnFetch/`
   - GLOBAL: the authenticated trigger runs public job APIs and enabled ATS
      boards via `lib/server/sources/`
4. AU worker pulls config: `GET /api/fetch-runs/:id/config` (guarded by secret).
5. AU worker sends `start`, ordered `commit`, or `fail` commands to
   `POST /api/fetch-runs/:id/commit`, guarded by `x-fetch-run-secret`. CN and
   GLOBAL call `commitFetchRun` in-process.
6. `commitFetchRun` acquires `FRUN → JOBJ`, then atomically writes Jobs, a
   `FetchRunCommitReceipt`, counters, and any terminal status. Identical batch
   retries replay the stored receipt.
7. Jobs appear in `GET /api/jobs` and the `/jobs` UI.

All fetches are user initiated. There is no scheduled product fetch path.
Cancellation competes with commits for `FRUN`: it stops later batches but does
not roll back receipt-backed Jobs. A cancellation or failure after the first
commit is terminal `PARTIAL`. See ADR-0008.

## 2) External model CV/CL generation (skill pack + strict JSON import)

1. Download skill pack: `GET /api/prompt-rules/skill-pack` (optional `?redact=true`).
2. Build a per-job prompt: `POST /api/applications/prompt` with `{ jobId, target }`.
3. Generate strict JSON in external model using:
   - skill pack prompt templates and rules
   - expected JSON schema returned by the prompt API
4. Import + render PDFs: `POST /api/applications/manual-generate` with:
   - `jobId`, `target`, `modelOutput` (strict JSON string), and **matching** `promptMeta`

Hard rule: never import without `promptMeta`.

