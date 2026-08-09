# ADR-0016: Persist Agent queue identity and recover only provable Hermes work

- **Status:** Superseded — by ADR-0018 for Hermes recovery (section 5), and by
  ADR-0019 for the Fit-queue durability decisions, which retired with the fit
  feature itself.
- **Date:** 2026-08-02
- **Context owner:** Joblit Engineering

## Context

The local Runner crosses two independent durability boundaries: Joblit owns
the Fit and tailoring queues in PostgreSQL, while the user's unmodified Hermes
gateway owns model execution on loopback. The first Fit implementation encoded
a short lease in `Job.fitSource = claim:<uuid>` and inferred expiry from the
Job's generic `updatedAt`. That made the composition of a batch disappear when
its lease expired and allowed unrelated Job updates to change lease semantics.
It also left batch creation and retry vulnerable to two callers both observing
that no active `ApplicationBatch` existed before either inserted one.

Hermes 0.19.1 exposes a random id only after `POST /v1/runs` succeeds. Its Runs
API has no durable idempotency key and no lookup by caller operation identity.
Consequently, if the request reaches Hermes but the response is lost before
Joblit records that random id, blindly submitting again can execute the prompt
twice. Joblit cannot honestly manufacture exactly-once delivery across that
gap without forking Hermes or requiring a future upstream operation API.

## Decision

1. **Fit batch identity is a durable server aggregate.** A `FitBatchClaim`
   owns an immutable, ordered set of `FitBatchClaimItem` identities, a stable
   content-addressed issue, an independent lease, and a rotating execution
   attempt. Lease takeover changes the attempt fence, not the batch contents.
   `Job.fitSource` may be dual-written during rollout, but it is no longer the
   lease authority.

2. **Fit settlement is exact and receipt-first.** The server validates the
   claim, prompt receipt, attempt, and complete claimed Job set under one
   transaction. Accepted scores, deterministic failed-item outcomes, the
   append-only `FitBatchImportReceipt`, and the terminal Claim projection are
   committed together. An identical receipt replay succeeds even after lease
   takeover; conflicting reuse fails closed. Recovery reports one of active,
   settled, or terminal-without-settlement. During rolling deployment, an old
   receipt or an old-server prompt is reconciled back to the matching durable
   attempt so it cannot leave an `ACTIVE` Claim blocking the queue.

3. **Application batch creation has one deep entry point.** New and retry
   creation both acquire the existing per-user Job mutation lock, check for an
   active batch, choose the exact Job set, and create the header and tasks in
   one transaction. A PostgreSQL partial unique index independently enforces
   at most one `QUEUED` or `RUNNING` batch per user. The enforcing migration
   first repairs historical header counts and terminalizes empty or already-
   finished active headers, so the new guard never preserves a stale owner.

4. **Permanent Job deletion coordinates with active batches.** After the
   per-user Job lock, deletion row-locks target Jobs by stable id before it
   reads and locks affected Application Batches. The row fence makes an older
   writer's in-flight FK insert either commit before that read or fail after
   deletion. It then recomputes each surviving batch's task count and terminal
   state in the same transaction. An active batch with no remaining tasks
   becomes `CANCELLED`; a historical terminal batch keeps its audit outcome
   while its count is repaired. Intentional deletion is not reported as model
   failure.

5. **Hermes recovery is proof-based.** Before reserving a new run, the Runner
   records only a non-secret session transcript cursor. If a Runs start response
   is lost, a later process may recover output only when the post-cursor
   transcript proves one unambiguous user turn and one corresponding terminal
   assistant result. A tool-call or incomplete assistant row never qualifies by
   itself; a completed tool sequence is recoverable only when one later unique
   `finish_reason: "stop"` assistant result exists and no assistant/tool row
   follows it. Otherwise the Runner preserves the reservation and returns an
   unknown-start error. It never retries an unprovable start. Hermes
   `cancelled` and `failed` terminal statuses are distinct typed outcomes;
   retryable HTTP statuses are deferred instead of being recorded as model
   failure. When Joblit already proves the operation accepted or terminal, a
   known live private run is stopped and polled terminal before local cleanup;
   an ambiguous `starting` reservation still requires transcript proof.

6. **Stock Hermes remains an external boundary.** Joblit does not patch or
   fork Hermes and does not claim provider-level exactly-once execution. A
   future official durable operation-key API can replace the transcript adapter
   behind the Runner without changing the Joblit queue aggregates.

## Consequences

- Fit leases no longer depend on `Job.updatedAt`, and crash recovery retains the
  exact batch instead of silently regrouping work.
- Database constraints remain the final concurrency guard even if an API route
  or a future caller forgets the application-level check.
- Old Fit Runner envelopes remain accepted during the expand deployment, so
  the database and Runner can roll forward independently. Application releases
  use migration-before-build plus atomic alias cutover: old app revisions may
  drain in-flight requests, but must not remain in the request pool beyond the
  five-minute legacy lease window.
- Fit adds durable rows and heartbeat/observation traffic. Terminal metadata is
  retained, but full prompts, model output, Hermes keys, and private `run_*`
  identifiers are not stored in PostgreSQL.
- A narrow, unavoidable Hermes start ambiguity still exists. The safe outcome
  is visible deferred work requiring later proof or operator action, never an
  automatic duplicate model call.
