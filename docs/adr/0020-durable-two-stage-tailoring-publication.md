# ADR-0020: Persist tailoring output before publishing PDFs

- Status: Accepted
- Date: 2026-08-10
- Supersedes the direct-FINAL batch path described by ADR-0009 for newly
  claimed Runner work; protocol v1 remains a rolling-deployment fallback.

## Context

The original batch protocol combined four boundaries in one request: accept
model output, merge the Application, render LaTeX, upload a PDF, and settle the
batch task. A Resume could commit successfully and the following Cover render
could time out or lose its response before any Cover receipt existed. The
Runner then knew neither whether it was safe to retry nor how to expose the
already generated Cover for review.

The old FINAL client also ignored the successful PDF response body. That could
prevent its HTTP connection from being reused by the immediately following
Cover request.

## Decision

New first-party Runners explicitly advertise protocol versions `[2, 1]` when
claiming. A missing capability list means protocol v1. A task that is already
bound to a v1 FINAL Tailoring Run remains v1 for its lifetime.

Protocol v2 is a two-stage state machine:

1. The Runner requests a target prompt with `delivery: DRAFT`.
2. `manual-generate?finalize=false` validates the model result and atomically
   persists the Application content plus its immutable `TailoringRunReceipt`.
   It returns the owned `applicationId` and aggregate `aiContentHash`.
3. The Runner publishes that target through
   `POST /api/applications/:id/finalize?target=...`, echoing the Tailoring Run
   and batch execution attempt. Rendering and upload happen outside the short
   database transaction.
4. The commit transaction rechecks ownership, content identity, render context,
   and execution fences, then records one immutable
   `TailoringRunPublicationReceipt` per run and target.

A batch task succeeds only when every required target is both accepted and
published. `acceptedTargetMask` and `publishedTargetMask` are independent,
constrained projections; an existing PDF is not publication proof unless its
target content hash matches the accepted receipt.

Publication settlement is recoverable without another model call. An
ambiguous response is replayed with the same Application, content hash, run,
target, and attempt. If it remains ambiguous, the task is returned to PENDING
behind a fresh attempt fence instead of holding the normal crash lease. Its
next claim contains only `remainingPublicationTargets`, so Codex is not run
again. A current artifact can settle the immutable publication receipt without
another render.

A deterministic publication failure may leave a valid DRAFT Application. The
batch result exposes its `applicationId`; the user can open the existing
full-screen Review & Edit flow, amend the content, and finalize it manually.
List and batch responses expose only identity and publication metadata. Full AI
content is loaded on demand from a session-only, tenant-checked, no-store review
snapshot endpoint.

The write lock order remains:

`TJOB -> ABAT (when batch-bound) -> TLRN -> JOBA`

No renderer or Blob request runs while these database locks are held.

## Consequences

- Generated Cover content survives renderer, Blob, transport, and response
  failures.
- Resume and Cover publication can be retried independently and idempotently.
- Old deployed Runners continue on protocol v1 during a server-first rollout.
- Protocol v2 needs two new Tailoring Run masks and the publication receipt
  table, so the expand migration must deploy before the new Runner is used.
- A task is not application-ready until both current PDFs are published.
- FINAL v1 responses are still supported and are fully consumed before the
  connection is reused.
