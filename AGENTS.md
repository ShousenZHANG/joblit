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

Agent-facing protocol routes accept either identity, and both resolve to the
same user-scoped context:

- **AgentCredential** — `Authorization: Bearer <token>`, minted through the
  session-only `/api/agent-tokens` route (reached from the Runner setup popover
  in the app nav) and stored as a SHA-256 hash. Version 1
  credentials use prefix `jfagent_v1_`, audience `joblit-agent`, and explicit
  `tailoring:execute` or `tailoring:control` capabilities. (`fit:drain` is a
  retired legacy value — tolerated on stored credentials, never required, no
  longer minted; ADR-0019.) This is how an unattended agent runs.
- **Session cookie** — an interactive browser session, for a human driving the
  same endpoints.

A presented Bearer credential is authoritative: it never falls back to the
cookie, so revoking a credential immediately stops the agent even in a browser
that is still signed in. An expired or revoked credential returns `401`.

Routes on the AgentCredential seam: `GET /api/application-batches/active`,
`POST /api/application-batches/:id/run-once`, `POST /api/applications/prompt`,
`POST /api/applications/manual-generate`, target-scoped
`POST /api/applications/:id/finalize`, and the `/api/tailoring-runs/:id`
route, cancel, and fail endpoints.
Batch creation, `/codex-run`, and the task `PATCH` route stay session-only;
an unattended Runner claims work and reports exceptional outcomes through
`run-once`. The fit queue and its routes were retired (ADR-0019).

The first-party implementation of this protocol is the Joblit Runner
(`tools/runner`, see its [README](tools/runner/README.md)) — a dependency-free
local worker that generates by running the official Codex CLI as a child
process. It holds no model credential of its own.

## Canonical APIs

- Enqueue Jobs for tailoring: `POST /api/application-batches/enqueue` (body `{ jobIds }`; appends to the live batch, or opens one)
- Claim run context (interactive session): `POST /api/application-batches/:id/codex-run`
- Orchestrated run step (report failure/skip + claim): `POST /api/application-batches/:id/run-once`
- Report task failure/skip (interactive session): `PATCH /api/application-batches/:id/tasks/:taskId`
- Batch summary (interactive session): `GET /api/application-batches/:id/summary`
- Prompt for external generation: `POST /api/applications/prompt`
- Persist generated artifact: `POST /api/applications/manual-generate`
- Publish one persisted target: `POST /api/applications/:id/finalize?target=resume|cover`

## Versioned Agent Request

An unattended Runner uses an `AgentCredential`, not a retired Extension token:

```http
Authorization: Bearer jfagent_v1_<64-lowercase-hex-characters>
Content-Type: application/json
```

The first-party Runner advertises `[2, 1]`; a missing capability list defaults
to v1 for rolling compatibility. After `run-once` returns a task, the prompt
request must echo its complete execution identity exactly. A new v2 task uses:

```json
{
  "jobId": "<tasks[].jobId UUID>",
  "target": "resume",
  "source": "codex_batch",
  "delivery": "DRAFT",
  "protocolVersion": 2,
  "issueKey": "<tasks[].issueKey UUID>",
  "batchId": "<batch.id UUID>",
  "batchTaskId": "<tasks[].id UUID>",
  "batchAttemptId": "<tasks[].attemptId UUID>"
}
```

Do not add these claim fields to the later `manual-generate` body: that strict
request echoes the prompt response's complete `tailoringRun` handle and
`promptMeta`. A v2 DRAFT response returns `applicationId` and `aiContentHash`;
the target finalize call echoes those identities plus the same Tailoring Run
and batch attempt. A bound FINAL/v1 run never upgrades to v2.

## Rules

- Do not use `/trigger` for execution. It is intentionally disabled.
- Every claimed task includes `attemptId`, the stable Joblit-derived
  `issueKey`, `protocolVersion`, `acceptedTargets`, `remainingTargets`,
  `publishedTargets`, and `remainingPublicationTargets`. Request and import
  only `remainingTargets`; publish only `remainingPublicationTargets`; never
  regenerate an accepted target after reclaim. Send `source: "codex_batch"`,
  the claim's exact `delivery` and `protocolVersion`, the current batch ID as
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
- Do not report `SUCCEEDED` through `PATCH` or `run-once`. Protocol v2 first
  commits each target's DRAFT and acceptance receipt, then independently
  commits its PDF and publication receipt. The final required publication
  settles task success. Failure and skip reports accept only `FAILED` or
  `SKIPPED` and must echo the claimed task's `attemptId`.
- Fence every in-flight model call against the prompt response's exact
  Tailoring Run `{ id, attemptId }`. Polling a non-terminal run must return that
  same active handle. A changed attempt means the lease was superseded: stop
  local work and preserve any recoverable state; never import it or report the
  newer attempt failed.
- If `run-once` returns no task while the batch is still `RUNNING`, honor its
  `execution.retryAfterMs` lease hint and poll again. An empty claim is not a
  terminal batch result.
- Mark a task `FAILED` with a concise error only for a deterministic,
  unrecoverable generation, validation, or publication failure. An ambiguous
  import/publication outcome, stale attempt, cancellation, or local cleanup
  failure is not such a failure. Release an unresolved v2 publication attempt;
  its next claim is publication-only and must not call the model.
- Keep idempotent behavior: same job/task should not produce inconsistent state.
- Prefer schema-valid JSON only; no markdown wrapper around payload JSON.
- Only the public `{ id, attemptId }` Tailoring Run handle crosses the Joblit
  boundary. Never send a local process, session, or model-side identifier.

## Runner Recovery

There is no local recovery state and no `~/.joblit/runner-state-v1.json`. A
generation is a child process: if the Runner dies, the child dies with it, so
nothing was produced and nothing was imported. The next run simply claims the
task again.

Duplicate protection therefore lives entirely server-side, on
`TailoringRunReceipt`, `TailoringRunPublicationReceipt`, and the exact attempt
fence. An agent that
does keep local state (an external orchestrator, say) must still reconcile it
against the server-owned Tailoring Run before claiming new work: an import
whose outcome is unknown is replayed unchanged, never reissued as new content.
Once a v2 DRAFT is accepted, publication recovery uses the stored Application;
`remainingPublicationTargets` never trigger another model call (ADR-0020).

## Deletion Contract

When deleting a job (`DELETE /api/jobs/:id`), remove the owned Application in
the same transaction that durably queues all current artifact pointers as
`ApplicationArtifact.DELETE_PENDING`. The protected reconciler owns the later
Blob deletion and claim-fenced settlement; do not perform network deletion
inside the Job mutation transaction or report a queued object as synchronously
deleted. After `JOBJ`, lock target Job rows in stable id order before reading
affected ApplicationBatch tasks; this fences pre-JOBJ writers whose FK insert
is still in flight during an expand deployment.
