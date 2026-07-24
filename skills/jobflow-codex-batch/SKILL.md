---
name: joblit-codex-batch
description: Execute Joblit NEW-job batch tailoring in a deterministic Codex loop and persist CV/Cover PDFs with task-level status updates.
---

# Joblit Codex Batch Skill

## Purpose

Run a deterministic, resumable batch loop that generates resume and cover outputs for filtered `NEW` jobs.

## Required Inputs

- `batchId` (UUID)
- `maxSteps` (default 1, recommended 3-5 per loop)
- External model output JSON for each target (`resume` and `cover`)

## API Sequence

1. Claim tasks
- `POST /api/application-batches/:id/codex-run`
- Read `tasks[]` and `context.generationContract`.
- Do not treat batch context as a generation receipt: no concrete job prompt
  exists yet.

2. Build target prompt per task
- `POST /api/applications/prompt` with `{ jobId, target }`
- Use returned `prompt` and `expectedJsonSchema`.
- Keep this exact response's `promptMeta`; it is bound to the target, prompt
  bytes, effective rules, resume snapshot, and job snapshot.
- Generate only the current schema returned for that target:
  - `resume`: `{ "cvSummary": string, "latestExperience": { "addedBullets": string[0..3] } }`
  - `cover`: `{ "cover": { "paragraphOne": string, "paragraphTwo": string, "paragraphThree": string } }`
- Do not emit legacy keys such as `skillsFinal`, full experience bullet lists,
  or section/header aliases.

3. Import generated output
- `POST /api/applications/manual-generate` with:
  - `jobId`
  - `target`
  - `source: "codex_batch"`
  - `modelOutput` (strict JSON string)
  - `promptMeta` (complete, unmodified echo from the target prompt response,
    including `ruleSetId`, `resumeSnapshotUpdatedAt`,
    `promptTemplateVersion`, `schemaVersion`, `skillPackVersion`, and
    `promptHash`)

4. Mark task state
- `PATCH /api/application-batches/:id/tasks/:taskId`
- Status:
  - `SUCCEEDED` when both targets are imported
  - `FAILED` with concise `error` when unrecoverable

5. Check summary
- `GET /api/application-batches/:id/summary`

## Hard Rules

- Always set `source: "codex_batch"` on Batch imports.
- Never skip, truncate, combine, or synthesize `promptMeta`; use the complete
  receipt issued for that exact job and target.
- Batch generation is current-only. A legacy schema accepted by interactive
  `manual_import` is not valid for `codex_batch`.
- Keep JSON strict: no markdown wrappers, no prose around JSON.
- Do not fabricate resume facts or unsupported claims.
- Fail fast with concise reason if parsing/validation fails.

## Completion Criteria

- No pending tasks in batch summary.
- Every processed task is `SUCCEEDED`, `FAILED`, or `SKIPPED`.
- Generated PDFs are downloadable from Joblit UI.
