# Retire CN and GLOBAL job intake

- Status: Accepted
- Date: 2026-08-09

Joblit now treats Australian discovery as its only active Fetch Pipeline. The
Nowcoder-based CN adapter and all GLOBAL public-feed/ATS-board adapters are
retired because they created a large maintenance and correctness surface while
their product entry points were unavailable; CN Job data, Chinese Resume data,
Chinese LaTeX, and the Chinese UI remain supported.

Retirement is intentionally staged. The first release makes every Fetch write
and execution boundary AU-only, removes the adapters, and runs a bounded,
artifact-aware cleanup that deletes historical CN/GLOBAL FetchRuns and GLOBAL
Jobs without creating `DeletedJobUrl` tombstones. After old application
instances are drained and Blob retirement converges, a second release removes
the obsolete source-health and ATS-board database structures. This avoids an
expand/contract deployment race and keeps future AU re-imports possible.

Stage 2 completed that contraction in
`20260809154500_drop_retired_source_tables`. Before release, production proved
that no CN/GLOBAL FetchRuns, GLOBAL Jobs, GLOBAL Applications, or active orphan
Application Artifacts remained, and that the full Blob inventory had completed
at `2026-08-09T05:39:01.099Z`. The migration repeats the durable row and
artifact preconditions under database locks, then drops `AtsBoardSource`,
`SourceHealth`, and their sole enum without `CASCADE`; any missing prerequisite
or unexpected dependency aborts the transaction.

Because the schema contraction can safely precede the application rollout, the
follow-up `20260809161000_verify_post_retirement_inventory` migration uses the
contract migration's durable `finished_at` as an ordering marker. A populated
environment cannot deploy the Stage 2 binary until a settled Blob inventory
completed after that marker and the legacy-row/orphan-Artifact checks still
converge. The deployed Stage 1 binary remains safe and retains the reconciler if
this fence fails.

The fence is intentionally a migration failure, so Prisma records the failed
attempt and will refuse blind retries with `P3009`. After the reconciler has
completed and the read-only gates pass, an operator must use the direct database
endpoint to run
`npx prisma migrate resolve --rolled-back 20260809161000_verify_post_retirement_inventory`,
then rerun `prisma migrate deploy`. It must never be marked applied manually.
Every failed retry creates a new failed attempt and therefore requires the same
resolve-as-rolled-back step before the SQL is allowed to run again.
