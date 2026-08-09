# Joblit flows (high signal)

## 1) FetchRun → discovery → receipt-backed commit → Jobs list

1. UI creates an AU FetchRun: `POST /api/fetch-runs`.
   New rows store strict `FetchRunConfig` v2 with the immutable recall policy;
   the reader accepts historical AU v1 rows only.
2. UI triggers: `POST /api/fetch-runs/:id/trigger`.
3. The trigger dispatches GitHub Actions `jobspy-fetch.yml` (Python
   `tools/fetcher/run_jobspy.py`). Non-AU creation/config/trigger/commit requests
   fail closed.
4. AU worker pulls config: `GET /api/fetch-runs/:id/config` (guarded by secret).
5. AU worker sends `start`, ordered `commit`, or `fail` commands to
   `POST /api/fetch-runs/:id/commit`, guarded by `x-fetch-run-secret`.
6. `commitFetchRun` acquires `FRUN → JOBJ`, then atomically writes Jobs, a
   `FetchRunCommitReceipt`, counters, and any terminal status. Identical batch
   retries replay the stored receipt.
7. Jobs appear in `GET /api/jobs` and the `/jobs` UI.

All fetches are user initiated. There is no scheduled product fetch path.
Cancellation competes with commits for `FRUN`: it stops later batches but does
not roll back receipt-backed Jobs. A cancellation or failure after the first
commit is terminal `PARTIAL`. See ADR-0008.

ADR-0017 retired CN Fetch/Nowcoder plus GLOBAL feed/ATS/source-health execution.
CN Jobs, Resume, Chinese LaTeX, and translated UI remain. Stage 2 removed the
writer-less `SourceHealth` and `AtsBoardSource` schema contract after legacy
rows, Application Artifacts, and Blob inventory converged.

## 2) External model CV/CL generation (skill pack + strict JSON import)

1. Download skill pack: `GET /api/prompt-rules/skill-pack` (optional `?redact=true`).
2. Build a per-job prompt: `POST /api/applications/prompt` with `{ jobId, target }`.
3. Generate strict JSON in external model using:
   - skill pack prompt templates and rules
   - expected JSON schema returned by the prompt API
4. Import + render PDFs: `POST /api/applications/manual-generate` with:
   - `jobId`, `target`, `modelOutput` (strict JSON string), and **matching** `promptMeta`

Hard rule: never import without `promptMeta`.

