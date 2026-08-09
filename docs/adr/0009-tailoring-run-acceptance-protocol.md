# ADR-0009: Make Tailoring Run acceptance durable and linearizable

- Status: Accepted
- Date: 2026-07-26

> **Implementation note — 2026-07-31:** ADR-0014 retired the browser Local AI
> writer. References to Local AI below describe the historical rollout and
> retained rows; current unattended imports come from the Agent Runner with an
> `AgentCredential` and a public Tailoring Run handle.

## Context

Manual import, Local AI, external Codex Batch, and the server batch runner all
produce the same Application AI proposals, but they previously had no shared
durable execution identity. Prompt issuance was transient, Local AI ownership
lived only in browser state, and batch output crossed the Application commit
boundary separately from `ApplicationBatchTask` completion. A lost response,
stale executor, or cancellation race could therefore leave the Application,
batch task, and caller with different accounts of what succeeded.

## Decision

### Persist one Tailoring Run per issued operation

Every generated Application proposal is associated with a `TailoringRun`. The
run records its source, requested delivery mode, required and accepted target
masks, prompt-receipt identities, Master Resume Profile and Job snapshot
hashes, current execution attempt, lease, and terminal projection.

Issuance is idempotent on `(userId, issueKey)`. `issueHash` detects reuse of the
same key for different inputs. A batch task has at most one associated run;
standalone manual and Local AI runs have no batch task.

The database deliberately does **not** persist full prompts, raw model output,
or Hermes-private `run_*` identifiers. Prompt receipts and snapshot hashes are
enough to bind accepted output to the issued inputs. The local Runner retains
any private Hermes request-to-run mapping outside the Joblit domain model.

Historical Applications are not backfilled with synthetic runs. A
`TailoringRun` is evidence of the new acceptance protocol, so inventing one for
an older artifact would create false execution history.

### Fence executors with an attempt UUID

The current `executionAttemptId` is the authority for new work. A start with
the same attempt may renew its lease; a different attempt may take ownership
only after the current lease is eligible for replacement. Lease expiry alone
does not authorize a stale executor: ownership changes only when the replacing
attempt commits under the Tailoring Run lock.

Batch tasks project the same attempt and lease while running. Their historical
integer `attempt` remains a count, not an authorization token.

`ApplicationBatchTask.tailoringProtocolVersion` is an explicit rolling-cutover
gate. Historical tasks are version 0. Claiming work in the new protocol
atomically upgrades the task to version 1, assigns the new
`executionAttemptId`, and clears `completionAttemptId`. PostgreSQL accepts a v1
`SUCCEEDED` projection only when `completionAttemptId` is non-null and equals
that current execution attempt. The acceptance transaction writes this proof;
failure, cancellation, and reclaim clear it. Therefore a drained old worker
cannot write an unreceipted success after a new attempt has claimed the task.

Failure requires the current execution attempt. User or batch cancellation
competes through the same locks as acceptance, so whichever transition commits
first is the observable winner.

### Make acceptance idempotent per target

Resume and Cover are independent Tailoring Run targets. Each accepted target
creates one immutable `TailoringRunReceipt`, unique on `(runId, target)`, with
the accepting attempt, canonical request hash, Application identity, accepted
AI Content hash, and delivery mode.

An identical retry returns the existing receipt. Reusing the target with
different content is a conflict. Receipt replay is run-scoped rather than
attempt-scoped: a response-loss retry may read already-committed evidence after
ownership changes, but that replay does not grant authority to accept another
target.

`manual-generate` probes this immutable receipt immediately after
authentication and body/prompt-receipt structure validation, before rate
limiting or any current Job, Resume Profile, prompt, renderer, or Blob
dependency. An exact probe validates the public handle plus source, delivery,
target, prompt hash, canonical request hash, and the receipt's owned
Application/Job association. It returns that Application and Job projection
without consulting today's profile or generation inputs. Reusing an accepted
target with a different request hash is `409 RECEIPT_CONFLICT`. A missing
receipt falls through to the complete first-acceptance validation path.
For a replayed DRAFT, the route returns the normal editable Application JSON.
For a replayed FINAL, it returns an explicit JSON acknowledgement with
`x-tailoring-replay: exact` rather than recreating the PDF response.

The run's target masks support both single-target manual/Local AI work and the
current Codex Batch contract, which requires Resume and Cover for one task. A
run is `PARTIAL` when durable target acceptance exists but the required set
cannot finish normally.

A batch claim derives one stable public UUID `issueKey` from the task identity
and returns both `acceptedTargets` and `remainingTargets`. Reclaim does not
erase an accepted target. Codex and the server adapter request, accept, render,
and merge only `remainingTargets`; `mergeTarget` preserves the already accepted
half of the stored Application.

### Commit the final target and batch success together

Application acceptance owns the database point of no return. Model parsing,
quality review, rendering, and content-addressed Blob upload happen before the
database transaction. The transaction persists the target's Application
mutation, its receipt, and the run projection together.

When that receipt completes the required target mask, the same transaction
also marks the linked `ApplicationBatchTask` `SUCCEEDED` and reconciles its
batch projection. No separate success callback is authoritative. If the
transaction fails, none of the Application acceptance, receipt, run terminal
state, or task success is visible; any newly uploaded unreferenced Blob is
cleaned up best-effort.

Failure and cancellation similarly update a linked non-terminal task in the
same transaction. Exact receipt-backed work is never rolled back or rewritten
as though it did not occur.

### Use one global lock order

Transactions acquire advisory locks in this order:

1. `TJOB` for `(userId, jobId)` while issuing a new run;
2. `ABAT` for the Application Batch, when a run is batch-bound;
3. `TLRN` for the Tailoring Run;
4. `JOBA` for the owning `(userId, jobId)` Application mutation.

Run issuance uses `TJOB -> ABAT -> TLRN` for batch runs and `TJOB -> TLRN`
for standalone runs. `TJOB` serializes manual and batch ownership decisions for
one Job, so only one active run can be issued. Acceptance uses
`TJOB -> ABAT -> TLRN -> JOBA`; ordinary Application content edits use
`TJOB -> JOBA` and fail while another run is active. Reverse acquisition is
forbidden.

When a new issue or unbound write encounters abandoned standalone work, it may
retire an expired `RUNNING` lease or an `ISSUED` run older than the hand-off
grace period. It takes the affected `TLRN` locks and rechecks the expiry before
terminalizing. Batch runs remain governed by their task reclaim protocol, and
an exact issue-key replay is resolved before stale-run retirement.

Batch cancellation takes `ABAT` before cancelling its runs in sorted `TLRN`
order. Acceptance rechecks batch and run state while holding the same locks.
This linearizes cancellation against the final target commit without holding
locks during model or network work.

### Cut over additively in three phases

The schema change is additive: new enums, `TailoringRun`,
`TailoringRunReceipt`, nullable attempt/lease/proof columns plus an explicit
protocol version on `ApplicationBatchTask`, and nullable relations to existing
records. Existing Applications and terminal tasks remain valid without a run.

Prompt responses first gain run identity as an additive field. Manual, Local
AI, Codex Batch, and server-batch adapters then move to run-bound acceptance.
**Phase A (expand/compatibility)** deploys schema and mixed-version readers.
Prompt-driven manual imports issue a single-target run, while legacy plain
manual submissions remain accepted without manufacturing evidence. Legacy
Local AI imports without a handle remain readable as historical data; new
Runner imports always carry a run handle. Codex Batch uses handles whenever it
enters the new protocol.

**Phase B (drain/writer switch)** pauses batch dispatch and drains old
deployments and in-flight claims before enabling v1 claiming. Each new claim
atomically upgrades the task protocol, rotates the attempt, clears completion
proof, and publishes accepted/remaining targets. Only final TailoringRun
acceptance can write the matching completion proof. Dispatch resumes only after
a fresh canary and a partial-target stale-reclaim canary both satisfy the task,
run, receipt, and Application invariants.

**Phase C (contract)** begins only after legacy Local AI envelope telemetry is
zero and old clients have drained. The fallback is then removed; the retired
Local AI writer is not revived, while current Runner imports require their
public TailoringRun handle. Historical tasks and Applications stay legacy; the
cutover never manufactures attempts, receipts, or successful Tailoring Runs.
Once every writer is v1, independent
`SUCCEEDED` task writes and integer-attempt authorization are retired.

## Consequences

- Every AI proposal source shares one durable acceptance seam and the same
  fencing, idempotency, cancellation, and terminal-state semantics.
- A batch task cannot report success before the final required Application
  target and its receipt are durable.
- Resume and Cover may become durable at different times; a failed second
  target is reported honestly as partial rather than erasing the first receipt.
- The acceptance module is intentionally deeper than its HTTP and browser
  adapters. New execution sources reuse it instead of assembling lifecycle
  writes themselves.
- Blob storage remains outside the PostgreSQL atomic boundary and therefore
  requires deterministic object identities plus compensating cleanup.
