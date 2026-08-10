# ADR-0021: Enqueue chosen Jobs; keep one active batch by appending, not refusing

- Status: Accepted
- Date: 2026-08-10
- Supersedes the phrasing of ADR-0016 §3 ("Application batch creation has one
  deep entry point"). The one-active-batch invariant it protects is unchanged;
  what changes is how a second request meets that invariant.

## Context

Tailoring work could only be requested one way: a button beside the Jobs status
filter that queued every eligible `NEW` Job in one press. The server enforced
one `QUEUED` or `RUNNING` batch per user with a partial unique index, so a
second request while a batch was draining was answered `409
ACTIVE_BATCH_EXISTS`.

Both halves of that shape fought the way the product is used. The unit a user
actually decides on is one Job — they read a description and want that one —
but the only available action committed them to the whole inbox. And because
the refusal was structural rather than advisory, wanting one Job meant waiting
for a hundred unrelated ones to settle first, for a reason no part of the UI
could explain.

The refusal also made the queue feel fragile in exactly the situation where it
needed to feel solid. When a run stalled, the user could not start anything
else until it cleared, so a single stuck task blocked all new work rather than
just its own.

## Decision

Fresh tailoring work enters through `enqueueJobsForTailoring`, called by
`POST /api/application-batches/enqueue` with an explicit `jobIds` list. It
**appends** those Jobs to the live batch, and opens a `QUEUED` batch only when
none is draining. Asking again for a Job already in the queue is a no-op with a
plain answer, not an error.

The single-active-batch invariant is untouched — the partial unique index still
enforces it. The batch is now an implementation detail of how the Runner drains
work, rather than something the user has to schedule around.

Eligibility is unchanged from the sweep's: owned by the caller, market `AU`,
status `NEW`, and no existing Application. A task starts a two-target
`TailoringRun`, so admitting a Job that already has an Application could
overwrite a document the user accepted.

Lock order is JOBJ then BATCH, and this is the only site that holds both.
`JOBJ` serializes against permanent Job deletion so eligibility cannot straddle
it; `BATCH` serializes against the reconcile that would otherwise terminalize
the batch between the status read and the insert, stranding a `PENDING` task
that nothing would ever claim. The batch status is therefore re-read under the
batch lock, and a fresh batch is opened if it has settled.

`totalCount` is derived from a post-insert recount rather than incremented. An
increment that raced a concurrent enqueue would leave every progress readout
counting toward a total the batch never had. The count is returned to the
client, which needs it to render progress at all.

Failed-task retry keeps its own entry point, `POST
/api/application-batches/:id/retry-failed` through `queueApplicationBatch`.
Its seed union is narrowed to `retry_failed`; the `new` seed went with the
sweep that was its only caller.

## Consequences

`POST /api/application-batches` and `GET /api/application-batches/preflight`
are retired and must not be reintroduced. `ACTIVE_BATCH_EXISTS` is no longer
reachable from any UI path.

There are now two creation entry points rather than one, which is the cost of
this decision and the thing ADR-0016 §3 was written to avoid. They are kept
honest by both taking the per-user Job mutation lock first, and by the index
that neither of them can violate.

Batch discovery on page load had to be corrected in the same change.
`GET /api/application-batches/latest` ordered by `updatedAt` with no status
filter, which was equivalent to the retired preflight's status-based selection
only while the live batch was always the most recently touched row. It is not:
a Runner replaying a receipt against an already-terminal batch bumps that row
after a newer batch was queued. `/latest` now prefers an active batch and falls
back to the most recent one.

One capability narrows. Cancel and Retry-failed live only in the batch details
dialog, which now opens only from the progress banner. The banner cannot be
dismissed while a run is live, so cancelling work in flight is always
reachable; what is lost is reopening a *finished* run's dialog after dismissing
its banner. Per-row tailoring badges and the per-Job "Try again" cover that
case, and cover it per Job rather than per batch.
