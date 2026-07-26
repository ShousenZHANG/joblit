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
- Claimed task `attemptId` (UUID)
- Claimed task `issueKey` (stable UUID derived by Joblit, reused across retries)
- Claimed `acceptedTargets` and `remainingTargets`
- External model output JSON for each target in `remainingTargets`

## API Sequence

1. Claim tasks
- `POST /api/application-batches/:id/codex-run`
- Read `tasks[]`, including each task's `attemptId`, `issueKey`,
  `protocolVersion`, `acceptedTargets`, and `remainingTargets`, plus
  `context.generationContract`.
- A v1 claim is authoritative: generate and import **only**
  `remainingTargets`. Never request, regenerate, or re-import a target already
  listed in `acceptedTargets`; its immutable receipt and stored Application
  half survive stale reclaim.
- Do not treat batch context as a generation receipt: no concrete job prompt
  exists yet.

2. Build each missing target prompt
- `POST /api/applications/prompt` once for each target in
  `remainingTargets` with:
  - `jobId`
  - `target`
  - `source: "codex_batch"`
  - `delivery: "FINAL"`
  - the claimed task's exact `issueKey`
  - `batchId`
  - `batchTaskId: taskId`
  - `batchAttemptId: attemptId`
- Use returned `prompt` and `expectedJsonSchema`.
- Keep this exact response's `promptMeta`; it is bound to the target, prompt
  bytes, effective rules, resume snapshot, and job snapshot.
- Keep the returned `tailoringRun` handle. Every missing-target request for the
  same task must resolve to the same run and current attempt.
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
  - `tailoringRun` (the complete, unmodified handle returned with the prompt)
  - `promptMeta` (complete, unmodified echo from the target prompt response,
    including `ruleSetId`, `resumeSnapshotUpdatedAt`,
    `promptTemplateVersion`, `schemaVersion`, `skillPackVersion`, and
    `promptHash`)
- Treat either the initial PDF response or an exact-replay JSON
  acknowledgement (`replayed: true`, `acceptedDelivery: "FINAL"`,
  `x-tailoring-replay: exact`) as a successful import. The latter means the
  immutable target receipt and Application were already committed before an
  earlier HTTP response was lost; do not render or import the target again.

4. Report only exceptional task completion
- `PATCH /api/application-batches/:id/tasks/:taskId`
- Send the claimed task's `attemptId`.
- Status is only `FAILED` with a concise `error`, or `SKIPPED`.
- Never send `SUCCEEDED`. Importing the final required target atomically commits
  the Application, target receipt, Tailoring Run success, and batch task
  success.

`POST /api/application-batches/:id/run-once` follows the same rule:
`completedTasks` accepts only `FAILED` or `SKIPPED`, and each entry requires
`attemptId`.

5. Check summary
- `GET /api/application-batches/:id/summary`

## Hard Rules

- Always set `source: "codex_batch"` on Batch imports.
- Always request prompts with `source: "codex_batch"`, `delivery: "FINAL"`,
  the batch/task/attempt binding, and the claimed task `issueKey`.
- Treat `acceptedTargets` as immutable durable work. Only
  `remainingTargets` may be requested, generated, accepted, rendered, or
  merged during a reclaimed attempt.
- Never skip, truncate, combine, or synthesize `promptMeta`; use the complete
  receipt issued for that exact job and target.
- Never skip, alter, or reconstruct `tailoringRun`; echo the public handle from
  the prompt response into `manual-generate`.
- Batch generation is current-only. A legacy schema accepted by interactive
  `manual_import` is not valid for `codex_batch`.
- Keep JSON strict: no markdown wrappers, no prose around JSON.
- Do not fabricate resume facts or unsupported claims.
- Fail fast with concise reason if parsing/validation fails.
- Never expose a private Hermes `run_*` identifier to Joblit. The public
  Tailoring Run handle is the only run identity in this contract.

## Completion Criteria

- No pending tasks in batch summary.
- Every processed task is `SUCCEEDED`, `FAILED`, or `SKIPPED`.
- Generated PDFs are downloadable from Joblit UI.
