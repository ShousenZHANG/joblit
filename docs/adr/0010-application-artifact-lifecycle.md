# ADR-0010: Make Application artifact retirement durable

- Status: Accepted
- Date: 2026-07-26

## Context

Application PDF and TeX files live in Vercel Blob while their current pointers
live on the PostgreSQL `Application` row. Blob upload and deletion cannot share
a transaction with the Application mutation. The previous protocol uploaded
before the database commit, removed a new upload after a failed commit, and
removed a superseded object after a successful commit. Those compensations were
best-effort network calls. A process crash, timeout with an ambiguous response,
or lost retry intent could leave an unreferenced object indefinitely or make
deletion ownership impossible to prove.

Blob inventory alone cannot close that gap. A listing reports what happens to
exist in one external system; it does not say whether an object is being
staged, is still referenced, is inside a retirement grace period, or is owned
by an active deletion attempt.

## Decision

### Persist one lifecycle row per Application artifact

`ApplicationArtifact` is the durable lifecycle ledger for these four targets:

- `RESUME_PDF`
- `COVER_PDF`
- `RESUME_TEX`
- `COVER_TEX`

Each row has a logical `pathname`, an optional Blob `url`, content-version and
content-hash metadata, lifecycle state, retry projection, claim fence, and
timestamps. Neither pathname nor URL presentation is physical identity:
`storageIdentity = lower(store hostname) + decoded pathname` is unique, so URL
query/fragment/encoding aliases converge while equal pathnames in different
stores remain separate. Before `put` reveals the store hostname, a unique
`provisionalIdentity = pending:<pathname>` serializes the ambiguous upload
window.

The first generation of a content version uses its deterministic immutable
pathname, and an exact retry may reuse that pathname only while its ledger row
remains `STAGED` or `REFERENCED`. Once any row for a pathname enters
`DELETE_PENDING`, `DELETING`, or `DELETED`, that pathname is a permanent
tombstone. A later generation of the same bytes receives a UUID incarnation
suffix and therefore a new physical pathname. Active incarnations remain
idempotent for exact retries.

`userId`, `jobId`, and `applicationId` are identity snapshots, not relations.
The model deliberately has no foreign keys to `User`, `Job`, or `Application`.
A ledger row must survive deletion of the source aggregate long enough to
prove and settle retirement. User erasure and Job/Application deletion flows
must therefore explicitly retire matching artifacts by their scalar identity;
database cascades are not lifecycle work.

The `Application` URL columns remain the current aggregate pointers during the
rollout. `ApplicationArtifact` records how the external objects reach and leave
that aggregate; it does not replace the Application itself.

### Encode the state projection in PostgreSQL

The lifecycle is:

| State | Meaning |
|---|---|
| `STAGED` | A durable upload intent exists. The URL may still be null before `put`, then attached after a successful upload. |
| `REFERENCED` | The same database transaction has made an Application URL column point at this object. `applicationId`, `url`, and `referencedAt` are required. |
| `DELETE_PENDING` | Retirement intent is durable and eligible no earlier than `deleteAfter`. `deleteAfter` and `deleteRequestedAt` are required; pathname is the deletion identity when URL is unknown. |
| `DELETING` | One worker owns the external call through `claimId` and `claimLeaseExpiresAt`. It may delete by pathname when a crashed stage never recorded its URL. |
| `DELETED` | A fenced worker or reconciliation pass has settled deletion and recorded `deletedAt`. |

Database checks reject a negative retry count, a half-present claim/lease pair,
or a state carrying incompatible claim, scheduling, error, reference, or
deletion fields. These checks make the lifecycle projection safe for workers to
query without reconstructing state from nullable columns.

### Stage, reference, and retire durably

New writers use this order:

1. Allocate the immutable `applications/` pathname and insert `STAGED` before
   calling Blob storage. Use the deterministic base while it is active; after
   retirement, allocate a UUID incarnation instead of reviving the pathname.
2. Upload outside the database transaction.
3. Attach the returned URL to the still-`STAGED` row.
4. Under the existing Application mutation lock, atomically update the
   Application URL pointer, transition the new artifact to `REFERENCED`, and
   transition the superseded artifact to `DELETE_PENDING`.
5. If the Application commit cannot land, persist retirement of the uploaded
   staged object as `DELETE_PENDING`; do not rely on an in-memory compensation
   callback as the only evidence.

The database transaction is the reference point of no return. Blob storage
still is not transactional, but every incomplete stage and every retirement
now has a durable reconciliation identity.

### Make account erasure an explicit transaction boundary

There is currently no supported account-deletion route in this repository.
This ADR therefore defines an integration point without claiming that account
erasure is already wired:

1. The future account-deletion service must call
   `prepareApplicationArtifactsForAccountErasure` with its transaction client
   before deleting the `User` row, and must delete that row in the same
   transaction.
2. The hook moves every tenant `STAGED`, `REFERENCED`, and `DELETE_PENDING` row
   to immediately eligible `DELETE_PENDING`, including pathname-only stages.
   It resets retry delay but does not steal an active `DELETING` claim.
3. The same transaction purges rows already settled as `DELETED`. It reports
   the number of active `DELETING` rows so the account workflow can observe that
   asynchronous storage erasure is still in flight.
4. After reconciliation settles later work,
   `purgeDeletedApplicationArtifactsForErasedUser` first proves the `User` row
   is absent in that transaction, then removes only the tenant's `DELETED`
   ledger metadata. The absent-user reconciliation sweep is the safety net for
   stages created by an already-running writer around the deletion boundary.

The durable Blob worker, not the account request, owns external I/O. Account
deletion can therefore commit without holding a database transaction open
across Blob calls, while the ledger retains the minimum scalar deletion
identity until the object is settled. A legacy physical object that is still
referenced by another live Application cannot be erased yet: the mandatory
current-pointer fence protects its bytes, and the erased user's ledger
snapshot remains until the last live reference retires. This shared-object
case and Blob listing consistency are the irreducible asynchronous tail of the
erasure protocol. Erasure is not complete at the storage layer while any row
remains non-`DELETED`, and cannot make progress while the protected reconciler
is disabled or unhealthy. The future account-deletion workflow must monitor
that operational tail; this repository does not yet provide its request/status
record.

There is one unavoidable upload ambiguity: Blob may persist the object and the
process may crash before `put` returns or before its URL is recorded. An
expired `STAGED` row therefore may move directly to `DELETING` and issue an
idempotent delete by its immutable reserved pathname. `DELETING.url` is
intentionally optional for this recovery path; its retirement timestamps,
claim UUID, and lease are still required. Inventory adopts the matching
provisional row if it later observes the object, rather than creating a second
ledger row. If deletion fails, the row returns to `DELETE_PENDING` with
retry/backoff state and continues deleting by pathname. Normal explicit
retirement usually also carries the known URL.

### Claim, call, and settle with a fence

A deletion worker:

1. claims an eligible `DELETE_PENDING` row, or an expired unreferenced
   `STAGED` row, in a short database transaction, writes a fresh UUID `claimId`
   and lease, clears any prior scheduling error, and transitions it to
   `DELETING`;
2. calls Blob deletion outside the transaction;
3. settles with a predicate on both `state = DELETING` and the exact
   `claimId`.

Success transitions to `DELETED`, records `deletedAt`, and clears the claim.
Failure transitions back to `DELETE_PENDING`, increments `retryCount`, stores a
bounded error, and schedules `nextAttemptAt` with backoff. An expired lease may
be reclaimed with a new claim UUID. A late response from the old caller cannot
settle the new claim. The claim fence protects database settlement; permanent
pathname tombstones provide the separate cross-system ABA fence. Even if an old
external delete call completes after its lease expires, no later writer can
have uploaded new bytes at that pathname.

Immediately before the external delete call, the worker must query all four
current Application URL columns for the candidate physical identity. Any
current reference aborts deletion. An active URL-known `STAGED` row may be
repaired to `REFERENCED`; a retirement tombstone stays `DELETE_PENDING` and is
never revived. Trusted writer paths use a finite, index-friendly URL
presentation search. Metadata-null migration/inventory rows add a broader
legacy scan capped at 200 candidates; exhausting that budget is indeterminate
and fails closed. Pathname-only deletion checks current pointers across stores.
The check runs in a short claim-validating transaction after taking the
Application mutation lock. This is a mandatory second fence for
already-committed legacy duplicate references and eventually consistent
inventory, not an optional optimization. It cannot fence an old binary that
writes after authorization without participating in the ledger protocol; Phase
C therefore starts only after pre-cutover binaries have drained.

### Reconcile only the Application namespace

Every run drains the durable retirement candidates first. It then lists only
the `applications/` Blob prefix with a bounded default budget of two 50-object
pages. A singleton database checkpoint leases the scan and persists its cursor;
cursor advance is claim-fenced, a partial run releases the lease, and a crash
can resume after lease expiry. Inventory marks known rows with
`inventorySeenAt` and registers unknown objects for a grace period before
retirement. It never treats one listing pass as proof that an object is
deleted, and the current-Application URL check still runs before every delete.
If inventory observes a supposedly `DELETED` physical identity again, it
requeues that tombstone as `DELETE_PENDING`; it never resurrects the pathname
as active.

The `resume-photos/` namespace and Resume Photo lifecycle are explicitly out of
scope. Resume Photo has separate ownership, access, validation, and deletion
rules and must not be swept by this ledger or inventory job.

### Roll out through expand, backfill, dual-write, and cutover

**Phase A + B — ordered expand/backfill and dual-write.** This source revision
implements both phases, but production deploys them in order: first apply the
additive enums, table, checks, indexes, and backfill; only then deploy the
writer, Job-deletion retirement outbox, and reconciler binary.

The migration reads all four non-empty Application URL columns and writes
`REFERENCED` rows with the observed `userId`, `jobId`, `applicationId`, and
target. Standard Vercel Blob URLs under `applications/` retain their pathname.
Non-standard URLs receive a deterministic
`legacy/<md5(storageIdentity)>` internal pathname. Backfill deduplicates by
canonical physical identity, so query/fragment aliases are represented once
while the same pathname in different Blob stores remains separate.
Conflict-tolerant insertion prevents duplicate historical pointers from
blocking deployment. `referencedAt` is the registry observation time; it is not
presented as the unknown historical upload time. No content hash or version is
invented.

After the migration lands, every Application PDF and TeX writer and every
Job/Application deletion path records durable stage/reference/retirement
state. The existing Application URL columns and read behavior remain unchanged.
A shared physical object is represented once by `storageIdentity`; the
mandatory live-pointer query protects it until every reference is gone.

**Phase C — protected worker canary and cutover.** The same revision supplies
the authenticated claim/call/fenced-settle worker, but production deletion
remains disabled unless `ARTIFACT_RECONCILE_ENABLED` is exactly `true` or `1`.
The scheduled route performs no inventory, claim, or delete side effect while
disabled. The route exposes a global kill switch, not a tenant selector. After
the migration and writer are deployed and all older binaries have drained,
enable one bounded worker run and verify retry, lease takeover, stale-settle
rejection, checkpoint progress, and current-reference repair before leaving
the schedule enabled. Default candidate and inventory limits bound each run.
The flag is independent: setting it false stops new worker side effects without
rolling back schema or writers.

**Phase D — contract.** Drain legacy best-effort cleanup queues and require
every new Application artifact to have a lifecycle row. Retire compatibility
paths only after telemetry shows no untracked current URL and no unknown
`applications/` object beyond the grace period. Historical artifacts remain
backfilled observations rather than synthetic execution history.

Rollback during Phases A or B disables new lifecycle writers/workers but keeps
the additive table and backfill. Once Phase C has deleted an object, a database
rollback cannot restore its bytes; worker rollout must therefore have an
independent kill switch and bounded canary.

## Consequences

- Upload and deletion remain cross-system operations, but incomplete work and
  retries gain a durable identity.
- Claim-call-fenced settle prevents a stale worker from recording the result of
  a newer worker's deletion attempt.
- Permanent pathname tombstones plus UUID incarnations prevent a stale external
  delete call from deleting bytes uploaded by a later generation.
- The ledger survives source-row deletion. The required account-erasure hook
  retires unclaimed work and purges settled rows transactionally; the
  absent-user sweep and guarded post-settlement purge close the asynchronous
  tail. No user-facing account-deletion route is implemented yet.
- Canonical physical identity assumes one lifecycle row per Blob object.
  Legacy shared references and URL aliases are tolerated by backfill and
  protected by the live Application pointer query until the final reference is
  gone.
- Inventory inherits Blob listing pagination and consistency limits. It is a
  reconciliation signal, not reference authority.
- Resume Photo remains a separate lifecycle and cannot be deleted by the
  Application artifact worker.
