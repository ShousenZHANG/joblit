# Data — `prisma/schema.prisma`

29 models, 20 enums, 55 migrations. Client generates to `lib/generated/prisma`
and is reached through the singleton in `lib/server/prisma.ts:13` over
`PrismaNeon`. Vocabulary is `CONTEXT.md`.

---

## Model inventory

| Model                                    | Domain meaning                                                                                      | Status                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `User`                                   | Tenant root, OAuth identity                                                                         | Live — adapter-owned                                                                                                                |
| `Account`, `Session`                     | NextAuth records                                                                                    | Live — adapter-owned                                                                                                                |
| `Job`                                    | A **Job** from the Fetch Pipeline                                                                   | Live                                                                                                                                |
| `FitBatchImportReceipt`                  | Durable exact-replay settlement for one content-addressed Fit issue                                 | Live, append-only                                                                                                                   |
| `FitBatchClaim`                          | Durable owner, attempt fence, lease, and prompt receipt for one exact Fit batch                     | Live                                                                                                                                |
| `FitBatchClaimItem`                      | Immutable ordered Fit batch membership plus terminal per-Job outcome                                | Live                                                                                                                                |
| `ApplicationBatch`                       | A **Codex Batch** run header                                                                        | Live                                                                                                                                |
| `ApplicationBatchTask`                   | One Job's slot in a batch                                                                           | Live                                                                                                                                |
| `TailoringRun`                           | Durable execution/fencing identity for one issued Application tailoring operation                   | Live                                                                                                                                |
| `TailoringRunReceipt`                    | Immutable per-target acceptance receipt                                                             | Live, append-only                                                                                                                   |
| `DeletedJobUrl`                          | Tombstone for a canonical `jobUrl` the user deleted                                                 | Live                                                                                                                                |
| `DailyCheckin`                           | Per-local-date triage streak                                                                        | Live                                                                                                                                |
| `FetchRun`                               | A Fetch Pipeline task                                                                               | Live                                                                                                                                |
| `FetchRunCommitReceipt`                  | Durable idempotency receipt for one ordered FetchRun batch and applying attempt                     | Live, append-only                                                                                                                   |
| `ResumeProfile`                          | A **Master Resume Profile**, per name per Resume Locale                                             | Live                                                                                                                                |
| `ActiveResumeProfile`                    | Pointer to the active profile per `(userId, locale)`                                                | Live                                                                                                                                |
| `Application`                            | The **Application** for one `(userId, jobId)`                                                       | Live                                                                                                                                |
| `ApplicationArtifact`                    | Durable PDF/TeX Blob lifecycle ledger (ADR-0010); scalar identity snapshots, no source foreign keys | Live                                                                                                                                |
| `ApplicationArtifactInventoryCheckpoint` | Singleton lease/cursor for bounded, resumable Blob inventory                                        | Live                                                                                                                                |
| `ApplicationEvent`                       | Immutable status ledger — the source of truth per ADR-0007                                          | Live, append-only                                                                                                                   |
| `EvidenceSnapshot`                       | Content-addressed evidence backing AI claims                                                        | **Written, never read**                                                                                                             |
| `ClaimEvidence`                          | Claim → evidence edge                                                                               | **Written, never read**                                                                                                             |
| `PromptRuleTemplate`                     | Per-user **Skill Pack** rule set                                                                    | Live                                                                                                                                |
| `AgentCredential`                        | Versioned, audience-bound and capability-scoped Runner credential; SHA-256 hash only                | Live                                                                                                                                |
| `OnboardingState`                        | Onboarding checklist and stage                                                                      | Live                                                                                                                                |
| `DiscoverVideoCache`                     | Global Discover cache + daily-refresh lease (ADR-0005)                                              | Live                                                                                                                                |
| `SourceHealth`                           | Global per-source status/counters/timestamps                                                        | Live — upserted by `sourceHealthStore.ts`, read through `readSourceHealth.ts`                                                       |
| `AtsBoardSource`                         | Global ATS board registry                                                                           | Live — **no insert path in TypeScript**; DB rows require external provisioning, while `JOBLIT_ATS_BOARDS_JSON` remains runtime-only |

The Career-workspace tables ADR-0006 kept without writers, and the extension's
own three, were dropped in `20260731120000_drop_extension_and_career_tables`
against measured row counts. `EvidenceSnapshot` and `ClaimEvidence` are written
but never read — they are **not** in that group and still receive writes from
`persistReviewLedger.ts`.

---

## Ownership and tenancy

Most models carry `userId String @db.Uuid` with a `Cascade` FK to `User`. Two
use it as the key rather than a column: `ActiveResumeProfile`
(`@@id([userId, locale])`) and `OnboardingState` (`userId @unique`).

`ApplicationBatchTask` and `ClaimEvidence` carry both a parent id and a
denormalised `userId`, so a tenant filter never needs a join.
`FetchRunCommitReceipt` and `TailoringRunReceipt` deliberately scope ownership
through their required run parent; commit callers never supply a tenant id.
`FitBatchClaim` carries `userId` directly and owns its immutable items.
`FitBatchImportReceipt` also keeps `userId` so the tenant-scoped issue key
remains directly addressable even if its optional Claim relation is later
removed by cascade cleanup.
`ApplicationArtifact.userId`, `jobId`, and `applicationId` are deliberately
denormalised identity snapshots with no relations. Lifecycle rows survive
source deletion and must be retired explicitly rather than by cascade.

Four models are global: `ApplicationArtifactInventoryCheckpoint` (`key @id`),
`DiscoverVideoCache` (`key @id`), `SourceHealth` (`source @id`, deliberate per
the schema comment), and `AtsBoardSource`.

| Family          | Scoping                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs            | `where: {userId, …}` — `jobListService.ts:122-127`; raw SQL injects `j."userId"` at `jobSearchService.ts:119`                                     |
| Applications    | Composite `userId_jobId`, or `findFirst({where:{id, userId}})`                                                                                    |
| Tailoring runs  | `TailoringRun.userId`; receipts inherit ownership through their required run                                                                      |
| Fit settlements | `FitBatchImportReceipt @@unique([userId, issueKey])`; the import module derives the same user from AgentCredential/session auth                   |
| Resume profiles | `where: {userId, locale}`; active pointer via `userId_locale`                                                                                     |
| Agent           | `AgentCredential.tokenHash` → `userId` at `requireAgentCredential.ts`; version, audience, capability, expiry, and revocation are checked together |

Ownership sits in the **write predicate**, not only the read:
`jobDeleteService.ts:107` and `:188` keep `userId` inside the `deleteMany`.

### FetchRun execution projection

| Field                                                         | Authority                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FetchRun.userId` (`:350`)                                    | Sole tenant authority for config reads and commits.                                                                                                                                                          |
| `FetchRun.userEmail` (`:355`)                                 | Nullable pre-v1 compatibility snapshot. New code neither writes nor reads it; deletion waits for a separate contract migration after the rollback window.                                                    |
| `executionAttemptId` + `executionLeaseExpiresAt` (`:371-372`) | Current executor fence and takeover deadline. The migration check requires both to be null or both non-null. Lease expiry permits a new `start`; it does not revoke the current UUID until takeover commits. |
| `expectedBatchCount` + `nextBatchIndex` (`:369-370`)          | Cheap projection of the one ordered batch stream.                                                                                                                                                            |
| `FetchRunCommitReceipt.executionAttemptId` (`:397`)           | Attribution of the attempt that applied a batch. Receipt replay is keyed by run + batch identity/content, so replay survives attempt takeover without authorizing new writes.                                |

`dispatchMeta` remains inside `FetchRun.queries` only for pre-`start` dispatch
claim/idempotency and the rolling fallback for RUNNING inline rows with no
relational attempt. It is not an execution lease once `start` has populated
the fields above.

### Fit settlement projection

| Field                              | Authority                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FitBatchClaim` + ordered items    | Durable authority for one exact Job set. Lease takeover rotates `executionAttemptId` without regrouping Jobs.                                                           |
| Claim prompt hashes + `promptMeta` | Bound once at prompt issuance; settlement validates the stored receipt rather than rebuilding mutable profile/rule state. Full prompts and model output are not stored. |
| `FitBatchImportReceipt.issueKey`   | Stable 64-hex prompt/Claim identity, unique per user. `claimId` is also unique for protocol-v2 settlements.                                                             |
| `requestHash`                      | Hash of protocol, issue, sorted Job ids, exact model output, and prompt receipt. Same issue with different content conflicts.                                           |
| `settlement`                       | Strict JSON projection that accounts for every Claim item as `scored` or deterministically `failed`. Exact replay is receipt-first.                                     |
| `Job.fitSource = claim:<uuid>`     | Rolling-deploy compatibility projection only. It is no longer the lease authority once a durable Claim exists.                                                          |

### TailoringRun acceptance projection

| Field                                                         | Authority                                                                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TailoringRun.executionAttemptId` + `executionLeaseExpiresAt` | Current executor fence and takeover deadline. A stale attempt cannot accept new output after takeover.                                                                                  |
| `requiredTargetMask` + `acceptedTargetMask`                   | Required and durably accepted Resume/Cover projection.                                                                                                                                  |
| `issueKey` + `issueHash`                                      | Idempotent issuance identity; same key with different issued inputs is rejected.                                                                                                        |
| `promptReceipts` + snapshot hashes                            | Bind accepted output to the issued prompt/profile/job without storing full prompts or model output.                                                                                     |
| `TailoringRunReceipt`                                         | Immutable evidence for one `(run, target)` acceptance. Exact replay returns the receipt; conflicting content is rejected.                                                               |
| `ApplicationBatchTask.executionAttemptId`                     | Batch-side projection of the same active attempt.                                                                                                                                       |
| `tailoringProtocolVersion` + `completionAttemptId`            | Historical rows remain v0. A v1 claim upgrades atomically and clears proof; v1 success is database-valid only when the final receipt writes `completionAttemptId = executionAttemptId`. |

### Application Artifact lifecycle projection

| Field/state                              | Authority                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pathname` / `url`                       | Logical immutable path and its optional presentation. Physical identity is the unique canonical `storageIdentity`; `provisionalIdentity` serializes the pre-upload window. |
| `STAGED` / `REFERENCED`                  | Durable upload intent versus an object committed into one of the four current Application URL columns.                                                                     |
| `DELETE_PENDING`                         | Durable retirement with pathname, grace deadline, request time, retry count, and optional URL/next attempt.                                                                |
| `DELETING`                               | Leased UUID claim. URL is optional so an expired stage can be deleted idempotently by pathname.                                                                            |
| `DELETED`                                | Fenced settlement observation with `deletedAt`; metadata is retained only until explicit account-erasure cleanup proves it is safe to purge.                               |
| `ApplicationArtifactInventoryCheckpoint` | Singleton claim/lease plus persistent Blob cursor; each run drains outbox work first, then scans at most two 50-object pages by default.                                   |

The migration backfills current URL pointers as `REFERENCED`. Standard Vercel
Blob `applications/` paths retain their pathname; non-standard or colliding
legacy paths receive stable `legacy/<md5(storageIdentity)>` pathnames. The
same change dual-writes lifecycle state and supplies the protected worker;
production still deploys the migration before the writer binary and validates
one bounded deletion run before broad scheduling.
`ARTIFACT_RECONCILE_ENABLED` is default-off and only exact
`true` / `1` permits inventory, claim, or delete. Phase C waits until old
binaries have drained. Deletion must query all four live Application URL
columns immediately before the external call, and inventory must scan only
`applications/`, never `resume-photos/`.

An exact retry may reuse an active `STAGED` or `REFERENCED` pathname. Retirement
is irreversible: once a pathname reaches `DELETE_PENDING`, `DELETING`, or
`DELETED`, it remains a permanent tombstone, and later identical content uses a
UUID incarnation pathname. This prevents an expired worker's delayed external
delete from erasing a newer generation. Trusted writer paths use a finite
reference lookup; metadata-null legacy rows use a 200-candidate fallback that
fails closed when its budget is exhausted. Inventory requeues a reappearing
`DELETED` object for deletion instead of reviving it.

---

## Cascade and deletion

Selected relations. `Cascade` from `User` is universal and omitted here.

| Child.field                         | Parent                  | Rule         | Line  |
| ----------------------------------- | ----------------------- | ------------ | ----- |
| `ApplicationBatchTask.batch`        | `ApplicationBatch`      | Cascade      | `304` |
| `ApplicationBatchTask.job`          | `Job`                   | Cascade      | `308` |
| `TailoringRun.applicationBatchTask` | `ApplicationBatchTask?` | SetNull      | `369` |
| `TailoringRun.resumeProfile`        | `ResumeProfile?`        | SetNull      | `366` |
| `TailoringRun.application`          | `Application?`          | SetNull      | `372` |
| `TailoringRunReceipt.run`           | `TailoringRun`          | Cascade      | `414` |
| `TailoringRunReceipt.application`   | `Application?`          | SetNull      | `420` |
| `FetchRunCommitReceipt.fetchRun`    | `FetchRun`              | Cascade      | `394` |
| `ActiveResumeProfile.resumeProfile` | `ResumeProfile`         | Cascade      | `444` |
| `Application.job`                   | `Job?`                  | **SetNull**  | `458` |
| `Application.resumeProfile`         | `ResumeProfile?`        | **SetNull**  | `461` |
| `ApplicationEvent.job`              | `Job?`                  | **SetNull**  | `506` |
| `ApplicationEvent.application`      | `Application?`          | **SetNull**  | `508` |
| `EvidenceSnapshot.application`      | `Application?`          | **SetNull**  | `547` |
| `EvidenceSnapshot.job`              | `Job?`                  | **SetNull**  | `549` |
| `ClaimEvidence.application`         | `Application`           | Cascade      | `574` |
| `ClaimEvidence.evidenceSnapshot`    | `EvidenceSnapshot`      | **Restrict** | `576` |

`ClaimEvidence.evidenceSnapshot` is the only `Restrict` in the schema.
`ApplicationArtifact` is intentionally absent from the relation table: its
scalar snapshots have no foreign keys and survive User, Job, and Application
deletion until durable retirement and privacy cleanup settle.

### Account erasure integration point

No supported account-deletion route currently exists. A future account
deletion service must use one database transaction and call
`prepareApplicationArtifactsForAccountErasure(tx, { userId })` before deleting
the `User` row in that same transaction. The hook:

- makes `STAGED`, `REFERENCED`, and existing `DELETE_PENDING` rows immediately
  eligible for deletion, including a stage with no recorded URL;
- preserves and reports `DELETING` rows instead of stealing a live worker
  claim; and
- purges already-settled `DELETED` rows transactionally.

The reconciler handles the asynchronous tail after the User cascade. Once an
object settles, `purgeDeletedApplicationArtifactsForErasedUser` proves the
User is absent before removing only that user's `DELETED` ledger rows.
In-flight writers can still create a final `STAGED` row around the deletion
boundary because the ledger intentionally has no User foreign key; the
absent-user sweep is the required safety net. A legacy physical object shared
with another live Application remains pointer-protected until its last live
reference retires, so its erased-user ledger snapshot cannot be purged sooner.
Storage erasure stalls while the protected reconciler is disabled or unhealthy;
no account-erasure request/status model currently monitors that tail.

### What `jobDeleteService.ts` actually does

`deleteJob(userId, jobId)` — one transaction, 30 s timeout:

1. Take the per-user Job mutation lock first.
2. Read the owned Job; `null` returns `{alreadyDeleted: true}`.
3. Row-lock the owned Job ids in stable order, then discover and lock affected
   Application Batches. This fences an in-flight legacy task FK insert.
4. Take the Application mutation lock before reading artifact pointers.
5. Upsert the canonical `DeletedJobUrl` tombstone.
6. In the same transaction, convert the four current artifact pointers into
   durable `ApplicationArtifact.DELETE_PENDING` work.
7. Capture the Application's content-addressed EvidenceSnapshot ids, delete the
   Application, then remove only candidate snapshots with no surviving claims.
   Captured ids let the final shared reference be reclaimed even when an older
   Job deletion already set the snapshot's `jobId` to null.
8. Delete the owned Job row and reconcile affected batch headers.
9. Return `artifactRetirement.queued`; the protected reconciler owns the later
   Blob call and fenced settlement. The deprecated `blobCleanup` projection is
   retained additively for API compatibility while clients migrate.

`batchDeleteJobs` is the same shape, taking Application locks in **sorted id
order**, deduplicating artifact URLs, and using one
`createMany({skipDuplicates: true})` for the tombstones.

### Rows that survive with every non-user FK null

One is reachable from an ordinary delete: **`ApplicationEvent`**, which is
designed for it. `companySnapshot` and `titleSnapshot` exist so the row stays
meaningful after the Job is gone, and `applicationCooldownService.ts` reads
them.

`EvidenceSnapshot` no longer joins this set by default: after Application-owned
claim edges cascade, the delete service removes snapshots with no surviving
claim.
`ApplicationArtifact` can retain all three scalar snapshot identifiers, by
design, until external retirement and privacy cleanup settle.

---

## The `DeletedJobUrl` tombstone

Keeps a deleted Job from resurrecting on the next fetch. Rationale at
`jobImportService.ts:86-93`.

- **Writers**: two, both inside the delete transaction — `jobDeleteService.ts:98`
  (upsert) and `:180` (createMany).
- **Reader**: one — `jobImportService.ts:197`.
- **No delete path exists.** A tombstone is permanent for the life of the user
  row. This is why `app/api/jobs/bulk-ignore/route.ts` moves `NEW → REJECTED`
  instead of deleting.

Import dedupes in three layers: an in-payload `Set` (`:157-162`), the tombstone
exclusion (`:197-209`, with stored values re-canonicalized at `:204-206` so rows
written before a canonicalizer change still match), and
`@@unique([userId, jobUrl])` + `skipDuplicates` (`:212`). The job mutation lock
is the first statement (`:195`), so a delete cannot commit a tombstone between
the read and the inserts.

`canonicalizeJobUrl` (`lib/shared/canonicalizeJobUrl.ts:59`) strips `www.`, folds
LinkedIn subdomains, drops default ports, resolves a LinkedIn job id from the
path or query and rewrites to a canonical form, and keeps at most one stable
identity query param. It returns `""` on any parse failure. The same function is
used on the delete side, the import side, the CN normalizer, and liveness
matching.

---

## Enums

20 enums. Workflow state is grouped across Job/Application events, FetchRun,
Application Batch, Tailoring Run, and Application Artifact lifecycles.
`FitBatchClaimStatus` and `FitBatchClaimItemOutcome` encode durable Fit queue
ownership and complete per-item terminal accounting.
`ApplicationArtifactTarget` and `ApplicationArtifactState` establish the
stage/reference/retirement vocabulary used by the artifact lifecycle module
and reconciler. Historical enum members such as `ApplicationEventSource =
EXTENSION` remain readable audit values; they do not imply an active browser
extension writer.

The only enum with no TypeScript reference is `ApplicationBatchScope` (one
member, `NEW`, used solely as a schema default).

`EvidenceKind` declares seven members; only `RESUME_PROFILE` and
`JOB_DESCRIPTION` are ever written.

### The ADR-0007 job-status projection

All seven values stay in the enum because `ApplicationEvent.fromStatus`/`toStatus`
record history verbatim.

- **Stored**: seven.
- **Surfaced**: `ACTIVE_JOB_STATUS_VALUES = ["NEW","APPLIED","REJECTED"]` — `lib/shared/jobStatus.ts:24`
- **Projection**: `INTERVIEW`/`OFFER`/`ACCEPTED` → `APPLIED`, `WITHDRAWN` → `REJECTED`; unknown → `NEW` — `jobStatus.ts:40-45`, `:75`
- **Transitions**: `canTransitionJobStatus` projects the source and rejects any non-active target — `:78-85`

`toActiveJobStatus` is applied at exactly two call sites, both client-side:
`jobsQueryCache.ts:23` and `jobsUrlState.ts:40`. **It is not applied on any
server read path** — `jobListService.ts:159` selects `status` raw. Enforcement
elsewhere is at the API boundary: the list filter accepts all seven, status
writes accept only the three active values, and the transition gate rejects the
rest.

---

## JSON columns

| Column                                                               | Shape                                                                                                             | Validated by                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Job.fitMatrix`                                                      | AI requirement matrix; score aggregated deterministically                                                         | `FitMatrixSchema` — `lib/shared/schemas/fitMatrix.ts:53`                                                                                                                                                                                                                    |
| `Job.postingRiskFlags`                                               | `string[]` advisory flags                                                                                         | **Nothing** — coerced by `normalizePostingRiskFlags`                                                                                                                                                                                                                        |
| `FetchRun.queries`                                                   | Versioned market-specific execution config plus pre-start dispatch/idempotency metadata (`:375`)                  | Strict `FetchRunConfigV1Schema` for v1 rows; `normalizeFetchRunConfigV1` upgrades historical shapes—including GLOBAL source-only rows—at the execution boundary and fails closed for invalid versioned rows. Authoritative post-start lease fields are relational, not JSON |
| `FitBatchImportReceipt.settlement`                                   | Strict Fit settlement (`protocolVersion`, issue/request hashes, disjoint scored/failed outcomes)                  | `FitBatchSettlementSchema` on write and replay in `lib/server/jobs/fitBatchImport.ts`                                                                                                                                                                                       |
| `TailoringRun.promptReceipts`                                        | Target-keyed prompt identity only; never full prompt bytes or raw model output                                    | `normalizePromptReceipts` on issue and `readPromptReceipts` on lifecycle/acceptance reads                                                                                                                                                                                   |
| `ResumeProfile.{basics,links,skills,experiences,projects,education}` | Master Resume Profile sections                                                                                    | `ResumeProfileSchema` — `lib/shared/schemas/resumeProfile.ts:72`                                                                                                                                                                                                            |
| `Application.aiContent`                                              | **AI Content** — the ADR-0001 current-proposal snapshot with per-target provenance plus aggregate evidence/review | `aiContentSchema` — `lib/shared/schemas/aiContent.ts`, `.strict()`. Target provenance is optional for legacy v1 rows; a missing entry means unknown. The retired `skillsAdditions` key is stripped by a `z.preprocess`                                                      |
| `Application.atsValidation`                                          | Last ATS/PDF machine-readability result                                                                           | **Nothing** — written as an object literal, read back through a `typeof` guard                                                                                                                                                                                              |
| `Application.reviewReport`                                           | Reviewer report; the same object also lives at `aiContent.review`                                                 | `applicationReviewSchema` on write; **no server-side parse of the stored column**                                                                                                                                                                                           |
| `ApplicationEvent.metadata`                                          | Arbitrary payload                                                                                                 | **Nothing**                                                                                                                                                                                                                                                                 |
| `EvidenceSnapshot.payload`                                           | `{path, excerpt}`                                                                                                 | **Nothing** — and nothing reads it back                                                                                                                                                                                                                                     |
| `PromptRuleTemplate.{cvRules,coverRules,hardConstraints}`            | Skill Pack rule lists                                                                                             | **Nothing** — typed `unknown`, coerced by `normalizeRuleList`                                                                                                                                                                                                               |
| `OnboardingState.checklist`                                          | Five boolean flags                                                                                                | The **patch** is validated, not the stored column                                                                                                                                                                                                                           |
| `DiscoverVideoCache.payload`                                         | Namespaced cache blob or the daily-claim lease                                                                    | **Nothing** — cast on write and read                                                                                                                                                                                                                                        |

---

## Constraints that encode a domain rule

| Constraint                                                                                                          | Rule                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Job @@unique([userId, jobUrl])` (`:309`)                                                                           | A Job is identified within a user by its canonical `jobUrl`. With `skipDuplicates` this makes import idempotent with no find-then-create race.                                                                                                                                      |
| `DeletedJobUrl @@unique([userId, jobUrl])` (`:459`)                                                                 | One tombstone per user per URL; makes both delete paths idempotent.                                                                                                                                                                                                                 |
| `FetchRunCommitReceipt @@unique([fetchRunId, batchKey])` (`:534`) and `@@unique([fetchRunId, batchIndex])` (`:535`) | One request identity and one ordered slot per run; same-content retries replay across attempts, while conflicting content or order fails closed. The receipt's `executionAttemptId` is attribution, not part of either unique key.                                                  |
| `Application @@unique([userId, jobId])` (`:624`)                                                                    | One Application per `(userId, jobId)`. Note `jobId` is nullable and Postgres treats NULLs as distinct, so this does not bound orphaned Applications.                                                                                                                                |
| `ActiveResumeProfile @@id([userId, locale])` (`:576`)                                                               | Exactly one active Master Resume Profile per `(user, Resume Locale)` — enforced as the primary key, so upsert is the only way to move the pointer.                                                                                                                                  |
| `ApplicationEvent @@unique([userId, idempotencyKey])` (`:716`)                                                      | Replay safety for the status ledger. A reused key with a different payload raises `IDEMPOTENCY_KEY_REUSED`.                                                                                                                                                                         |
| `EvidenceSnapshot @@unique([userId, contentHash, kind])` (`:752`)                                                   | Content-addressed reuse — identical evidence within one tenant is reused, not copied.                                                                                                                                                                                               |
| `ClaimEvidence @@unique([applicationId, claimHash, evidenceSnapshotId])` (`:776`)                                   | Claim edges are append-only and idempotent; a retry cannot duplicate the audit trail.                                                                                                                                                                                               |
| `ApplicationBatchTask @@unique([batchId, jobId])`                                                                   | A Job appears at most once per batch. Raw SQL also enforces one active (`QUEUED`/`RUNNING`) Application Batch per user.                                                                                                                                                             |
| `FitBatchClaim` raw partial unique index                                                                            | At most one `ACTIVE` Claim per user; release makes that exact Claim immediately reclaimable instead of creating a different batch.                                                                                                                                                  |
| `FitBatchClaimItem @@id([claimId, jobId])` + ordinal unique                                                         | Membership and order are immutable and duplicate-free for the life of a Claim.                                                                                                                                                                                                      |
| `FitBatchImportReceipt @@unique([userId, issueKey])` + unique `claimId`                                             | One canonical settlement per tenant issue and durable Claim; identical request hashes replay, conflicting content fails closed.                                                                                                                                                     |
| `TailoringRun @@unique([userId, issueKey])` (`:423`)                                                                | Issuing the same operation is idempotent within a tenant; `issueHash` detects conflicting reuse.                                                                                                                                                                                    |
| `TailoringRun.applicationBatchTaskId @unique` (`:388`)                                                              | A batch task has at most one Tailoring Run.                                                                                                                                                                                                                                         |
| `TailoringRunReceipt @@unique([runId, target])` (`:446`)                                                            | At most one immutable acceptance receipt per target; exact retries replay it.                                                                                                                                                                                                       |
| `ApplicationArtifact.storageIdentity @unique` / `provisionalIdentity @unique`                                       | One canonical physical identity per recorded object and one upload reservation per immutable pathname. Pathname and URL presentation aliases are deliberately non-unique. SQL checks also enforce non-negative retries, paired claims/leases, and state-compatible nullable fields. |
| `AgentCredential.tokenHash @unique`                                                                                 | Lookup by hash only; the raw `jfagent_v1_` credential is shown once and never stored.                                                                                                                                                                                               |
| `Job.companyRoleKey` — **index, deliberately not unique** (`:317`)                                                  | A soft "same opening" hint. Distinct openings can collide, so it powers a possible-duplicate badge and never an automatic removal.                                                                                                                                                  |
| `Job.descriptionSimHash` — **index only** (`:318`)                                                                  | Advisory 64-bit SimHash near-duplicate detection. It is never used as a unique key.                                                                                                                                                                                                 |
| Trigram GIN on `Job.title/company/location`                                                                         | Created by raw SQL in `20260330000000_search_optimization`, not by Prisma. Exists in the database but not in the model — flagged at `:307`. Powers the ILIKE relevance path.                                                                                                        |

---

## Advisory locks

The named critical sections use `pg_advisory_xact_lock` via `$executeRaw`; that
function returns `void`, which driver adapters cannot deserialize through
`$queryRaw`. The FetchRun dispatch guard is intentionally different: it uses
`pg_try_advisory_xact_lock` through `$queryRaw` because its boolean result is
the interface.

`lib/server/db/advisoryLock.ts` centralizes the `FRUN`, `JOBJ`, and `JOBA`
namespaces, their shared FNV-1a key, and the required broad-to-narrow order.
Older specialized namespaces remain local to their owning module; changing any
key derivation is a rolling-deployment compatibility change, not a refactor.

| Namespace           | Constant                                                                | Key                                                                                                                       | Taken by                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOBJ` `0x4a4f424a` | `db/advisoryLock.ts`, adapter `jobs/jobMutationLock.ts`                 | `stableInt32(userId)`                                                                                                     | `deleteJob`, `batchDeleteJobs`, `persistPreparedJobImport` — serializes generic and FetchRun imports against permanent delete                                  |
| `JOBA` `0x4a4f4241` | `db/advisoryLock.ts`, adapter `applications/applicationMutationLock.ts` | `stableInt32("${userId}:${jobId}")`                                                                                       | Both delete paths, `manual-generate`, `draft`, `finalize`, `discard`                                                                                           |
| `JOBC` `0x4a4f4243` | `applications/applicationEvents.ts:31`                                  | same                                                                                                                      | `appendApplicationEvent`, in a `Serializable` transaction. `bulkAppendStatusEvents` takes **no** advisory lock — its boundary is `updateManyAndReturn`         |
| `JOBF` `0x4a4f4246` | `jobs/fitRunService.ts`                                                 | `stableInt32(userId)`                                                                                                     | Durable Fit Claim acquire/takeover, prompt binding, heartbeat, cancellation/failure/release, and settlement; Job-touching flows take `JOBJ` first              |
| `FRUN` `0x4652554e` | `db/advisoryLock.ts`, adapter `fetchRuns/fetchRunLifecycleLock.ts`      | `stableInt32(runId)`                                                                                                      | Attempt `start`/takeover, commit, fail, stale recovery, and cancel. It serializes changes to the relational attempt fence and is always acquired before `JOBJ` |
| `ABAT` `0x41424154` | `tailoringRuns/tailoringRunLock.ts:3`                                   | `stableInt32(batchId)`                                                                                                    | Batch claim/completion/cancellation and batch-bound Tailoring Run acceptance; first lock in the global acceptance order                                        |
| `TLRN` `0x544c524e` | `tailoringRuns/tailoringRunLock.ts:4`                                   | `stableInt32(runId)`                                                                                                      | Tailoring Run issue/start/prompt binding/acceptance/fail/cancel; acquired after `ABAT` and before `JOBA`                                                       |
| `SHRC` `0x53485243` | `sources/sourceHealthStore.ts:11`                                       | per source, all acquired in one roundtrip via a `MATERIALIZED` CTE so the planner cannot hoist the lock ahead of the sort | `persistSourceHealthDiagnostics`                                                                                                                               |

One non-namespaced lock uses the single-`bigint` form:
`fetchRunLifecycleLock.ts` also exposes the trigger's
`pg_try_advisory_xact_lock` with a djb2 hash masked to 31 bits (collisions
documented as acceptable), and
`discoverCache.ts` uses no advisory lock at all — its daily claim is a row-level
lease fenced by a random `ownerToken` (ADR-0005).

---

## Migration history

55 migrations, `20260114042057_init_auth_jobs` →
`20260802120000_durable_agent_batch_integrity`.
Most are a single additive `ALTER TABLE`. The ones that changed a domain rule:

| Migration                                                         | Change                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260118091027_add_deleted_job_urls`                             | Introduced the tombstone. Deleting a Job became permanent for re-import.                                                                                                                                                                                            |
| `20260218170000_resume_profile_user_unique`                       | **Data-destructive.** Deleted all but the newest profile per user, then enforced one Master Resume Profile per user.                                                                                                                                                |
| `20260221124000_add_multi_resume_profiles`                        | Reversed that rule: added `name` + `revision` and `ActiveResumeProfile`.                                                                                                                                                                                            |
| `20260719093000_drop_legacy_resume_profile_user_unique`           | Four lines. Prisma's `DROP CONSTRAINT` had left the standalone index, so multi-profile was still blocked at the database level.                                                                                                                                     |
| `20260308120000_add_market_and_locale_fields`                     | Added Market and Resume Locale, including `Application.locale`; `20260731135000` later restored that column on production databases that had drifted.                                                                                                               |
| `20260308223201_add_locale_to_active_resume_profile`              | Moved the active-profile key to `(userId, locale)`.                                                                                                                                                                                                                 |
| `20260509000000_add_application_edit_workflow`                    | ADR-0001 / ADR-0002: the `ApplicationStatus` enum, `aiContent`, `aiContentHash`. Pre-existing rows are treated as finalized with NULL `aiContent`.                                                                                                                  |
| `20260405000000_fix_field_mapping_nullable_unique`                | Backfilled NULL → `''` because `NULL != NULL` made the upsert never match.                                                                                                                                                                                          |
| `20260720171000_add_career_lifecycle`                             | 331 lines, 8 enums and 8 tables — the ledger, global `SourceHealth`/`AtsBoardSource`, and the four tables ADR-0006 later retained.                                                                                                                                  |
| `20260720170000_extend_job_status`                                | Four `ADD VALUE`s, kept in their own migration so Postgres never consumes a new enum value in the same transaction.                                                                                                                                                 |
| `20260720190000_collapse_job_status`                              | **Data-only, ADR-0007.** Projects retired statuses. No enum values dropped — that would rewrite `ApplicationEvent` history.                                                                                                                                         |
| `20260724090000_fetch_run_commit_protocol`                        | ADR-0008: adds `PARTIAL`, ordered-batch counters, UUID attempt + lease pair check, non-negative/range checks, and receipt attempt attribution; makes the legacy `userEmail` snapshot nullable without dropping it.                                                  |
| `20260726090000_tailoring_run_acceptance_protocol`                | ADR-0009: adds Tailoring Run/Receipt, per-target masks and receipt uniqueness, UUID attempt fences, explicit legacy/v1 batch protocol version, current-attempt completion proof, and additive nullable relations without fabricating historical run evidence.       |
| `20260726120000_application_artifact_lifecycle`                   | ADR-0010: adds the durable Application PDF/TeX lifecycle ledger, state/claim projection checks, indexes, and conflict-tolerant backfill of the four current Application URL columns.                                                                                |
| `20260728120000_application_document_publication`                 | Adds independent Resume/Cover content and publication hashes plus the accepted document hash on Tailoring Run receipts.                                                                                                                                             |
| `20260731120000_drop_extension_and_career_tables`                 | Drops writer-less Career and browser-extension tables/enums after measured-data review; historical migrations and enum audit values remain immutable.                                                                                                               |
| `20260731130000_agent_runtime_expand_and_artifact_reconciliation` | Adds constrained `AgentCredential`, exact-replay `FitBatchImportReceipt`, and completes artifact physical-identity/checkpoint constraints without editing the already-applied ADR-0010 migration.                                                                   |
| `20260731135000_schema_convergence_expand`                        | Restores `Application.locale` with PostgreSQL's metadata-only constant default plus a validated check before `NOT NULL`, and restores the `ActiveResumeProfile.updatedAt` default so long-lived production and fresh history converge without a table rewrite.      |
| `20260731140000_drop_extension_token_and_legacy_artifact_uniques` | After the Agent Runtime deployment drained old browser-extension writers, drops `ExtensionToken` without `CASCADE` and removes legacy pathname/URL uniqueness only after validating the replacement physical-identity unique indexes and non-unique lookup indexes. |
| `20260802120000_durable_agent_batch_integrity`                    | Adds durable Fit Claim/item state, receipt attempt attribution, one-active Application Batch enforcement, reverse task lookup, and migration-time reconciliation of historical header counts plus empty/all-terminal active batches.                                |
| `20260330000000_search_optimization`                              | The only Postgres-extension-installing migration: `pg_trgm` plus three GIN indexes.                                                                                                                                                                                 |

After editing `prisma/schema.prisma`, run `npx prisma generate`.
