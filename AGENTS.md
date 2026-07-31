# Joblit Agent Playbook

This repository supports a Codex-driven batch workflow for CV/CL generation.

## Goal

Given a filtered set of `NEW` jobs, run a deterministic loop:

1. Claim next tasks from batch.
2. Reuse the durable Tailoring Run and fetch prompts only for the claim's
   authoritative `remainingTargets`.
3. Generate only those missing CV/CL JSON payloads from prompt + skill rules.
4. Import each missing payload and its Tailoring Run handle through
   `manual-generate`; never replace an already accepted target.
5. Report only unrecoverable `FAILED` or intentional `SKIPPED` outcomes.
6. Repeat until batch is complete.

## Authentication

Batch protocol routes accept either identity, and both resolve to the same
user-scoped session context:

- **Agent token** — `Authorization: Bearer <token>`, issued from the Joblit
  `/extension` page and stored hashed. This is how an unattended agent runs.
- **Session cookie** — an interactive browser session, for a human driving the
  same endpoints.

A presented Bearer token is authoritative: it never falls back to the cookie,
so revoking a token immediately stops the agent even in a browser that is still
signed in. An expired or revoked token returns `401`.

Routes on this seam: `GET /api/application-batches/active`,
`POST /api/application-batches/:id/run-once`, `POST /api/applications/prompt`,
`POST /api/applications/manual-generate`, the `/api/tailoring-runs/:id` route,
cancel, and fail endpoints, and the fit queue —
`POST /api/jobs/fit/{next-batch,prompt,batch-import,mark-failed,release-batch}`.
`/api/jobs/fit/run` and `/api/jobs/fit/prescreen` stay session-only: enqueuing
work is the user's action, draining it is the agent's.

The first-party implementation of this protocol is the Joblit Runner
(`tools/runner`, see its [README](tools/runner/README.md)) — a dependency-free
local worker that generates through a loopback Hermes gateway.

## Canonical APIs

- Create batch: `POST /api/application-batches`
- Claim run context: `POST /api/application-batches/:id/codex-run`
- Orchestrated run step (report failure/skip + claim): `POST /api/application-batches/:id/run-once`
- Report task failure/skip: `PATCH /api/application-batches/:id/tasks/:taskId`
- Batch summary: `GET /api/application-batches/:id/summary`
- Prompt for external generation: `POST /api/applications/prompt`
- Persist generated artifact: `POST /api/applications/manual-generate`

## Rules

- Do not use `/trigger` for execution. It is intentionally disabled.
- Every claimed task includes `attemptId`, the stable Joblit-derived
  `issueKey`, `acceptedTargets`, and `remainingTargets`. Request and import only
  `remainingTargets`; never regenerate an accepted target after stale reclaim.
  Send `source: "codex_batch"`, `delivery: "FINAL"`, the current batch ID as
  `batchId`, the claimed `taskId` as `batchTaskId`, its `attemptId` as
  `batchAttemptId`, and its exact `issueKey`.
- For every claimed task and remaining target, call
  `/api/applications/prompt`; always
  send that exact response's complete, unmodified `promptMeta` and returned
  `tailoringRun` handle to `manual-generate`: `ruleSetId`,
  `resumeSnapshotUpdatedAt`,
  `promptTemplateVersion`, `schemaVersion`, `skillPackVersion`, and
  `promptHash` are all required.
- Every Batch import payload must set `source: "codex_batch"`. It must conform
  to the current target `expectedJsonSchema`: Resume is
  `{ cvSummary, latestExperience: { addedBullets } }` with 0–3 additions;
  Cover is `{ cover: { paragraphOne, paragraphTwo, paragraphThree } }`.
- Batch import is current-only. Do not send legacy fields such as
  `skillsFinal`, full experience bullet lists, or section/header aliases.
- Batch run context exposes contract identity only. It never fabricates a
  `promptMeta` before a concrete job prompt exists.
- Do not report `SUCCEEDED` through `PATCH` or `run-once`. The final required
  target import atomically commits the Application, Tailoring Run receipt, and
  task success. Failure and skip reports accept only `FAILED` or `SKIPPED` and
  must echo the claimed task's `attemptId`.
- Mark task `FAILED` with a concise error when any step cannot recover.
- Keep idempotent behavior: same job/task should not produce inconsistent state.
- Prefer schema-valid JSON only; no markdown wrapper around payload JSON.
- Never expose a private Hermes `run_*` identifier to Joblit. Only the public
  `{ id, attemptId }` Tailoring Run handle crosses the Joblit boundary.

## Deletion Contract

When deleting a job (`DELETE /api/jobs/:id`), remove the owned Application in
the same transaction that durably queues all current artifact pointers as
`ApplicationArtifact.DELETE_PENDING`. The protected reconciler owns the later
Blob deletion and claim-fenced settlement; do not perform network deletion
inside the Job mutation transaction or report a queued object as synchronously
deleted.
