# ADR-0022: Retire the Runner, the batch queue and the TailoringRun ledger

- Status: Accepted
- Date: 2026-08-11
- Supersedes ADR-0009, ADR-0014, ADR-0016, ADR-0018, ADR-0020 (its run-fenced
  half) and ADR-0021.
- Does **not** supersede ADR-0015. This is the decision that finally honours it.

## Context

Generation had two doors. The documented floor was manual copy/paste: the app
issues a prompt, the user pastes it into any chatbot, and pastes the JSON back.
Everything else — the local Runner driving the Codex CLI, the Application Batch
queue that fed it, the TailoringRun leases, attempt fences and immutable
acceptance/publication receipts that made an unattended worker's retries safe —
existed to make the second door work.

That second door never opened for anyone. It required installing Node and the
Codex CLI, minting a bearer credential, and keeping a terminal running. The one
person who ever ran it was the person who built it, and for them it failed: a
deterministic database rejection on the cover import replayed itself forever
because the Runner reads any 5xx as "settlement unknown". Seven passes, no
output, a parked queue.

The cost of that door was most of the backend. It is also where the bugs were,
and the bugs were expensive to find precisely because the machinery was
sophisticated: receipts, fences and content-hash CAS are exactly the things
that make a failure hard to reason about when the failure is in them.

The requirement underneath all of it turned out to be small: a tailored cover
letter, and a rewritten resume summary.

## Decision

Delete the Runner and everything that existed to serve it.

- `tools/runner/**`, `tools/hermes/**`, `integrations/hermes/**`
- `lib/server/applicationBatches/**`, `lib/server/tailoringRuns/**`
- `app/api/application-batches/**` (12 routes), `app/api/tailoring-runs/**`
  (3 routes), `app/api/agent-tokens`, `app/api/agent/presence`
- `ApplicationBatch`, `ApplicationBatchTask`, `TailoringRun`,
  `TailoringRunReceipt`, `TailoringRunPublicationReceipt`, `AgentCredential`
- the batch UI: progress banner, details dialog, per-row tailoring badge,
  per-job Generate button, the Runner setup popover and presence chip
- `withAgentRoute` and the `codex_batch` generation source

Generation enters only through the manual path. `POST /api/applications/prompt`
becomes a pure read — it used to mint a TailoringRun on every call, including
for the browser's own copy/paste, which dragged a manual import through a
receipt probe and an acceptance commit it never needed.

`withAgentRoute` is deleted rather than renamed. Its three surviving callers —
prompt, manual-generate, finalize — move to `withSessionRoute`. The capability
argument has no session-side meaning: per-user scoping is already guaranteed by
`requireSession`.

## What survives, and why it is not collateral damage

ADR-0020's **document-level publication** survives whole. The four Application
columns (`resumeContentHash`, `coverContentHash`, `resumePublishedHash`,
`coverPublishedHash`) and `transitionApplicationPublication` are pure
Application state and import nothing from the run ledger. `/finalize` already
published exactly one target per call; the run's publication mask was
bookkeeping the batch needed, not the storage model. What dies is the
dual-receipt fence around it.

`applicationPublicationReplay` survives: its only caller is `/finalize`, where
it makes a repeated click a read instead of another LaTeX compile and upload.
That idempotency belongs to the browser, not the batch.

`acquireUnboundApplicationWriteAuthority` deletes rather than inlines. All three
of its steps existed to interleave with the TailoringRun table; the lock that
actually serialises two writers to one Application is `acquireApplicationMutationLock`,
taken independently and unchanged.

## Consequences

**Import idempotency narrows.** The receipt probe made a repeated paste return
the earlier verdict instead of committing again. The dialog's own in-flight
guard is what remains, and a DRAFT import compiles no PDF — so a double submit
costs a rewrite of identical content rather than a duplicate artifact.
`/finalize`, where the expensive work is, keeps its own replay.

**The `busy` guard on Review is gone.** It read TailoringRun to stop a user
opening an edit session while a Runner was mid-write on the same Job. There is
no concurrent writer left to lose that race against.

**Every agent credential is permanently revoked** when the migration runs.
Several leaked in plaintext during development and were never confirmed
revoked; dropping the table is the revocation. Until the migration is applied
in production they remain live.

**CN still has no generation.** The manual menu is gated `!isCN` and batch
eligibility was AU-only, so this is the status quo, not a regression — but the
server-side prompt builder already speaks `zh-CN` (locale-aware
`coverWordRange`, `salutationStyle`, date format), so lifting that gate is a
small, separate change.

**Generation is now 6 to 12 clicks and one context switch per job.** That is
worse than a working Runner and better than a Runner nobody can run. If it
proves too slow in practice, the next step is browser-side generation with the
user's own key: `POST /api/applications/prompt` and
`POST /api/applications/manual-generate` already accept a browser session, so
the server needs no changes for it — which is exactly the property ADR-0015 was
protecting.
