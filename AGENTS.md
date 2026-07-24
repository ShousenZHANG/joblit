# Joblit Agent Playbook

This repository supports a Codex-driven batch workflow for CV/CL generation.

## Goal

Given a filtered set of `NEW` jobs, run a deterministic loop:

1. Claim next tasks from batch.
2. Generate JSON payloads for CV/CL from prompt + skill rules.
3. Import payloads through `manual-generate`.
4. Mark task status.
5. Repeat until batch is complete.

## Canonical APIs

- Create batch: `POST /api/application-batches`
- Claim run context: `POST /api/application-batches/:id/codex-run`
- Orchestrated run step (complete + claim): `POST /api/application-batches/:id/run-once`
- Complete task: `PATCH /api/application-batches/:id/tasks/:taskId`
- Batch summary: `GET /api/application-batches/:id/summary`
- Prompt for external generation: `POST /api/applications/prompt`
- Persist generated artifact: `POST /api/applications/manual-generate`

## Rules

- Do not use `/trigger` for execution. It is intentionally disabled.
- For every claimed task and target, call `/api/applications/prompt`; always
  send that exact response's complete, unmodified `promptMeta` to
  `manual-generate`: `ruleSetId`, `resumeSnapshotUpdatedAt`,
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
- Mark task `FAILED` with concise error when any step cannot recover.
- Keep idempotent behavior: same job/task should not produce inconsistent state.
- Prefer schema-valid JSON only; no markdown wrapper around payload JSON.

## Deletion Contract

When deleting a job (`DELETE /api/jobs/:id`), related application records and blob artifacts should be cleaned up best-effort.
