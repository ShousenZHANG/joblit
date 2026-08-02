# ADR-0008: Make FetchRun execution commits durable and linearizable

- Status: Accepted
- Date: 2026-07-24

## Context

The three Fetch Pipeline adapters did not share one completion boundary.
The remote AU worker checked for cancellation, imported a batch through
`/api/admin/import`, then updated the `FetchRun` through a separate callback.
Cancellation could win between the check and the import, leaving newly
committed Jobs behind a run already shown as cancelled. The callback also had
no durable batch receipt, so a retry could not distinguish an applied batch
from an attempt whose response was lost.

CN and GLOBAL ran in-process and held the FetchRun lifecycle lock around their
outer work, but Job persistence opened its own transaction. A process failure
could therefore commit Jobs without committing the matching terminal
`FetchRun` projection.

`FetchRun.queries` also carried several historical, unversioned shapes. Each
adapter interpreted that JSON independently, making a persisted run dependent
on the reader version that happened to execute it.

## Decision

### Version the execution configuration

The initial cutover persisted `FetchRunConfig` v1 in `FetchRun.queries`. It is
a strict, market-discriminated contract:

- `{ schemaVersion: 1, market: "AU", ... }`
- `{ schemaVersion: 1, market: "CN", ... }`
- `{ schemaVersion: 1, market: "GLOBAL", ... }`

`lib/shared/schemas/fetchRunConfig.ts` is the single builder and reader seam.
It normalizes historical unversioned rows for execution, but an invalid
versioned row fails closed. New writers never emit a legacy shape. Execution
knobs are a creation-time snapshot; the trigger may patch only the typed
`dispatchMeta` bookkeeping inside the contract. The config route temporarily
includes the Python worker's historical scalar projection while exposing the
authoritative value as `run.config`.

AU creation subsequently advances to a strict v2 contract while CN and GLOBAL
remain on v1:

- `{ schemaVersion: 2, market: "AU", ... }`
- `{ schemaVersion: 1, market: "CN", ... }`
- `{ schemaVersion: 1, market: "GLOBAL", ... }`

AU v2 separates user search intent from server-owned filtering policy. It
persists `smartExpand: true`, `titleMatch: "relaxed"`, and
`includeFromQueries: true` as literals and embeds the immutable
`au-recall-safe-v1` policy. That policy caps seniority at mid-level using only
the visible job title; excludes only explicit Australian citizenship or
permanent-residency requirements and government-clearance requirements,
including an explicit requirement to be eligible to obtain clearance; and
never excludes a role because of years of experience. It contains no
`applyExcludes`, free-form title terms, or description/experience-rule arrays.

Policy identifiers are append-only execution contracts. Changing a rule
requires a new registry entry and a new active policy id; the meaning of an id
must never be edited in place. The active id controls creation only. Readers
resolve the policy id persisted in each row, require its snapshot to exactly
match that registry entry, and continue accepting every registered policy with
an implemented evaluator after the active id advances. A registered but
unsupported evaluator fails closed instead of borrowing the active policy's
meaning. The generic reader accepts strict v1 and AU v2 payloads. The v1-only
reader remains available during rollout and deliberately rejects v2, while
historical unversioned rows still normalize to v1. The compatibility scalar
projection for AU v2 remains
`includeFromQueries = true` and `filterDescription = true`. As with v1, only
typed `dispatchMeta` may be patched after creation; its patch operation must
preserve the schema version and policy byte-for-byte.

For GLOBAL runs, a non-empty v1 `sources` list is the exact creation-time
source snapshot even when `sourceSelection` is `all`. Execution neither drops
a source disabled later nor appends a source enabled later. Only an
unversioned legacy all-source row with no persisted IDs expands against the
current registry.

The rest of the v1 execution snapshot is equally immutable. Persisted title,
identity, clearance, sponsorship, and experience exclusion rule ids retain
their original v1 meaning. AU v2's recall-safe semantics apply only at its
explicit policy boundary and never reinterpret a historical AU or GLOBAL v1
row.

One legacy GLOBAL shape is intentionally preserved: a row containing only
`{ sources: [...] }` and no title or queries normalizes to
`queryMode: "source-only"`. The normalizer does not invent a query. Canonical
v1 permits this mode only with an explicit non-empty source selection while
`title`, `baseQueries`, and `queries` are all empty. Execution skips only role
matching; source selection, title exclusions, location, and freshness rules
still apply. This is a read-compatibility case; ordinary v1 GLOBAL creation
remains query-driven.

### Fence and resume one execution attempt

Every executor generates a UUID `attemptId` and must call `start` before it can
write results. Once `start` commits, `FetchRun.executionAttemptId` and
`FetchRun.executionLeaseExpiresAt` are the authoritative execution-ownership
boundary. Inline CN/GLOBAL attempts receive a 90-second lease; remote AU
attempts receive a 30-minute lease.

`start` is fenced under `FRUN`:

- replaying it with the current attempt renews the lease;
- a different attempt is rejected while the current lease is fresh;
- after expiry, a different `start` may replace the attempt and take ownership.

Clock expiry alone does not revoke the current executor. Its commands remain
valid until another `start` acquires `FRUN` and replaces
`executionAttemptId`. This lets a healthy AU worker finish after crossing its
initial lease while still allowing explicit takeover after process loss.

For a batch with no prior receipt, `commit` requires `RUNNING` and an exact
attempt match; every non-terminal commit renews the lease. External `fail`
also requires the current attempt, so a superseded worker cannot terminate its
replacement. Internal stale cleanup does not forge an attempt: it supplies a
`staleBefore` snapshot and rechecks `updatedAt` under `FRUN`, becoming a no-op
if newer progress won.

`dispatchMeta.inFlightAt`, `dispatchedAt`, and its idempotency fields are only a
pre-`start` dispatch claim. They also provide a rolling-upgrade fallback for a
RUNNING inline row whose `executionAttemptId` is still null. They never
authorize `commit` or `fail` and cannot override the relational attempt/lease
fields.

Takeover is not user cancellation. `RUN_CANCELLED` is reported as cancellation;
lease loss, lease contention, and an already-terminal run are reported as a
healthy supersession/handoff. For inline execution, the client observes the
same run for one lease interval, retries that run ID once after expiry, and
re-reads terminal/active state if the recovery POST races completion.

### Commit through one deep module

Remote and in-process adapters use `commitFetchRun` with protocol
`fetch-run-commit/v1`. The command is one of `start`, ordered `commit`, or
`fail`. Network discovery and normalization happen before this module; it owns
the database point of no return.

The AU adapter reaches it through
`POST /api/fetch-runs/[id]/commit`, authenticated with
`FETCH_RUN_SECRET`. CN and GLOBAL call the module directly. The module derives
the owner and market from the stored `FetchRun`; adapters cannot select a
different tenant by supplying an email or user ID.

Inline execution has one additional orchestration seam:
`executeInlineFetchRun`. It owns `start`, running-metadata projection, adapter
selection, the single terminal `commit` or `fail`, stop-reason mapping, and
exception recovery for both CN and GLOBAL. Market adapters receive only the
owning user and immutable query snapshot, then return a terminal plan; they do
not receive a run ID or attempt ID and cannot call `commitFetchRun` directly.
Discovery therefore begins only after the durable `start`, while every
terminal transition still crosses the same fenced commit boundary.

Every committed batch writes a `FetchRunCommitReceipt`. Within a run,
`batchKey` and `batchIndex` are unique. The receipt stores the canonical
request hash, import counts, and the `executionAttemptId` that applied it:

- replaying the same key and content returns the stored result;
- reusing a key for different content is a conflict;
- changing the declared batch count or sending a batch out of order is a
  conflict;
- the final declared batch is the only batch that may be terminal.

The terminal batch must carry `discoveredCount` for the entire run. It cannot
fall back to the last batch size, because a multi-batch worker would otherwise
publish a valid receipt stream with an incorrect terminal projection.

Receipt idempotency is run-scoped, not attempt-scoped. An identical request for
an already-applied batch may replay its receipt after ownership changes; that
replay does not grant authority to append another batch or issue `fail`. The
receipt's attempt is durable attribution of the writer, while the current
`FetchRun.executionAttemptId` fences all new work. Commit results expose the
receipt's canonical `executionAttemptId`, so adapters can distinguish their own
lost-response replay from another attempt replaying the same durable result.

An empty result still commits one terminal, empty batch, so successful
zero-result runs have the same durable completion evidence as non-empty runs.

### Linearize commit and cancellation

A commit transaction acquires locks in this fixed order:

1. `FRUN` for the FetchRun;
2. `JOBJ` for the owning user's Job mutations.

The transaction then persists Jobs, the batch receipt, counters, and any
terminal status together. No network operation runs while either lock is held.
All future code that composes these namespaces must preserve `FRUN → JOBJ`;
the reverse order is forbidden.

Cancellation acquires the same `FRUN` lock. This gives one observable winner:

- if cancellation acquires `FRUN` first, later batches are rejected and no new
  Jobs are committed for that run;
- if a batch commit acquires it first, that batch's Jobs and receipt are
  durable before cancellation is evaluated.

Cancellation stops future commits; it does not roll back earlier receipt-backed
Jobs.

An AU dispatch that fails before `start` also acquires `FRUN` before changing
the queued row to `FAILED`, and writes `terminalAt` in that transition. Thus
configuration, timeout, and dispatch rejection failures obey the same
terminal-audit invariant as executor failures.

GLOBAL source-health and user Job-liveness projections are applied only after
the fenced terminal `commit` or `fail` succeeds and the returned canonical
attempt matches the executor. Their discovery `observedAt` also advances
monotonically, so an older cross-run snapshot that writes late cannot replace a
newer observation. A same-attempt receipt replay may safely repair projections
after a lost response; a cancelled or superseded attempt cannot publish them.
ATS registry rediscovery remains a separate global compare-and-set module with
its own cooldown; it is not a user FetchRun projection.

Those projections are explicitly best-effort post-terminal hooks. A projection
failure is reported as a warning but cannot issue a second `fail` or rewrite an
already durable terminal result. Conversely, an exception after `start` but
before terminal commit—including failure to persist running dispatch
metadata—enters the coordinator's canonical `fail` recovery so an owned run is
not stranded in `RUNNING`.

### Make partial completion explicit

`PARTIAL` is a terminal FetchRun status. It is used when work has crossed the
commit boundary but the run does not complete normally, and when a
multi-source run deliberately reports a partial source failure. A failure
before any batch commit is `FAILED`; a cancellation or failure after a batch
commit is `PARTIAL`. `SUCCEEDED`, `FAILED`, and `PARTIAL` are all terminal in
the API and UI.

### Retire the split legacy callbacks

The original AU worker/server cutover moved both sides to the versioned v1
config and commit endpoints:

- `/api/admin/import` is retired;
- `/api/fetch-runs/[id]/update` is retired;
- `IMPORT_SECRET` is removed;
- `FETCH_RUN_SECRET` protects both config reads and v1 commit commands.

Historical unversioned config rows remain readable. AU creation has since
advanced to strict v2 policy-bearing configs, while CN and GLOBAL remain v1;
the generic reader accepts both versions and the v1-only reader deliberately
rejects v2. The compatibility projection on the config response is reader-only
and may be removed after the Python worker reads every field from `run.config`;
the retired write routes are not kept as dual-write fallbacks.

The cutover requires a short dispatch drain: pause new AU dispatches, wait for
all already-dispatched legacy GitHub Actions runs to become terminal, apply the
receipt migration, then deploy the server and v1 worker together before
re-enabling dispatch. This prevents an in-flight old worker from calling a
write route that the new server has intentionally removed.

`userEmail` follows an explicit expand/contract sequence. This migration only
drops its `NOT NULL` constraint. New code omits the snapshot and never reads,
returns, or trusts it; tenant ownership comes exclusively from
`FetchRun.userId`. Keeping the nullable column makes the database structurally
compatible with the old binary while its workers drain.

That rollback window is deliberately narrow. Rolling application code back to
a binary whose config reader accepts only v1 is safe only after AU dispatch is
paused and every AU v2 `QUEUED`/`RUNNING` row is terminalized, drained, or kept
behind a compatible v2 reader. The old JobSpy workflow must also be disabled
and drained, and no active AU row may depend on null `userEmail` or attempt
fencing. Terminal canaries do not execute again. The additive receipt table and
attempt columns can remain during a binary rollback.

Dropping `userEmail` requires a later, separately approved contract migration,
and only after all of these gates hold:

1. no queued or running old JobSpy workflow exists;
2. no deployed instance, worker artifact, or retained rollback binary reads or
   writes the column;
3. the operational rollback-retention window has expired;
4. production has no active AU FetchRun that could be handled by an old worker;
5. repository and release-artifact scans contain no executable `userEmail`
   dependency.

## Consequences

- A Job import, its idempotency receipt, counters, and terminal projection can
  no longer disagree because of a process crash between transactions.
- Worker retries are safe and observable without relying on Job URL dedupe as
  a substitute for command idempotency.
- Mid-stream cancellation may leave already committed Jobs, but the run reports
  that fact honestly as `PARTIAL`.
- Adapters must declare a stable ordered batch stream before committing its
  first batch. Changing the stream requires a new FetchRun.
- A lease timestamp is takeover eligibility, not a standalone authorization
  token. The attempt UUID is the fence.
- The commit module is intentionally deeper than its HTTP adapter: future
  in-process or queue-based executors reuse the same lifecycle semantics
  without making an internal network call.
- Deployment must follow the drain-and-cutover sequence above. The server and
  worker become live together because the old write routes are intentionally
  absent.
