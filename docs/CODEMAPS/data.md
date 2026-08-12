# Data — `prisma/schema.prisma`

19 models, 10 enums, 62 migrations. Client generates to `lib/generated/prisma`
and is reached through the singleton in `lib/server/prisma.ts:11` over
`PrismaNeon`. Vocabulary is `CONTEXT.md`.

---

## Model inventory

| Model                                    | Domain meaning                                                                                      | Status                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `User`                                   | Tenant root, OAuth identity                                                                         | Live — adapter-owned    |
| `Account`, `Session`                     | NextAuth records                                                                                    | Live — adapter-owned    |
| `Job`                                    | A **Job** from the Fetch Pipeline                                                                   | Live                    |
| `DeletedJobUrl`                          | Tombstone for a canonical `jobUrl` the user deleted                                                 | Live                    |
| `DailyCheckin`                           | Per-local-date triage streak                                                                        | Live                    |
| `FetchRun`                               | A Fetch Pipeline task                                                                               | Live                    |
| `FetchRunCommitReceipt`                  | Durable idempotency receipt for one ordered FetchRun batch and applying attempt                     | Live, append-only       |
| `ResumeProfile`                          | A **Master Resume Profile**, per name per Resume Locale                                             | Live                    |
| `ActiveResumeProfile`                    | Pointer to the active profile per `(userId, locale)`                                                | Live                    |
| `Application`                            | The **Application** for one `(userId, jobId)`                                                       | Live                    |
| `ApplicationArtifact`                    | Durable PDF/TeX Blob lifecycle ledger (ADR-0010); scalar identity snapshots, no source foreign keys | Live                    |
| `ApplicationArtifactInventoryCheckpoint` | Singleton lease/cursor for bounded, resumable Blob inventory                                        | Live                    |
| `ApplicationEvent`                       | Immutable status ledger — the source of truth per ADR-0007                                          | Live, append-only       |
| `EvidenceSnapshot`                       | Content-addressed evidence backing AI claims                                                        | **Written, never read** |
| `ClaimEvidence`                          | Claim → evidence edge                                                                               | **Written, never read** |
| `PromptRuleTemplate`                     | Per-user **Skill Pack** rule set                                                                    | Live                    |
| `OnboardingState`                        | Onboarding checklist and stage                                                                      | Live                    |
| `DiscoverCache`                          | Global GitHub-trending cache read by the nav popover                                                | Live                    |

The Career-workspace tables ADR-0006 kept without writers, and the extension's
own three, were dropped in `20260731120000_drop_extension_and_career_tables`
against measured row counts. `EvidenceSnapshot` and `ClaimEvidence` are written
but never read — they are **not** in that group and still receive writes from
`persistReviewLedger.ts`.

`ApplicationBatch`, `ApplicationBatchTask`, `TailoringRun`,
`TailoringRunReceipt`, `TailoringRunPublicationReceipt` and `AgentCredential`
were dropped in
`20260811090000_drop_runner_queue_and_tailoring_runs` (ADR-0022) together with
their seven enums. Dropping `AgentCredential` is also the revocation for every
agent token ever minted.

---

## Ownership and tenancy

Most models carry `userId String @db.Uuid` with a `Cascade` FK to `User`. Two
use it as the key rather than a column: `ActiveResumeProfile`
(`@@id([userId, locale])`) and `OnboardingState` (`userId @unique`).

`ClaimEvidence` carries both a parent id and a denormalised `userId`, so a
tenant filter never needs a join.
`FetchRunCommitReceipt` deliberately scopes ownership
through its required run parent; commit callers never supply a tenant id.
`ApplicationArtifact.userId`, `jobId`, and `applicationId` are deliberately
denormalised identity snapshots with no relations. Lifecycle rows survive
source deletion and must be retired explicitly rather than by cascade.

Two active models are global: `ApplicationArtifactInventoryCheckpoint`
(`key @id`) and `DiscoverCache` (`key @id`). The former GLOBAL source-health
projection and ATS-board registry were removed after the Stage 2 readiness
gate; neither has an active schema object.

| Family          | Scoping                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs            | `where: {userId, …}` — `jobListService.ts:66` `buildWhereClause`, `:97`; raw SQL injects `j."userId"` at `jobSearchService.ts:27`                 |
| Applications    | Composite `userId_jobId`, or `findFirst({where:{id, userId}})`                                                                                    |
| Resume profiles | `where: {userId, locale}`; active pointer via `userId_locale`                                                                                     |

There is no bearer-credential tenancy path left: ADR-0022 dropped
`AgentCredential`, so every request's tenant comes from the NextAuth session or,
for the AU worker, from the stored `FetchRun`.

Ownership sits in the **write predicate**, not only the read:
`jobDeleteService.ts:257` and `:347` keep `userId` inside the `deleteMany`.

### FetchRun execution projection

| Field                                                         | Authority                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FetchRun.userId` (`:249`)                                    | Sole tenant authority for config reads and commits.                                                                                                                                                          |
| `FetchRun.userEmail` (`:254`)                                 | Nullable pre-v1 compatibility snapshot. New code neither writes nor reads it; deletion waits for a separate contract migration after the rollback window.                                                    |
| `executionAttemptId` + `executionLeaseExpiresAt` (`:270-271`) | Current executor fence and takeover deadline. The migration check requires both to be null or both non-null. Lease expiry permits a new `start`; it does not revoke the current UUID until takeover commits. |
| `expectedBatchCount` + `nextBatchIndex` (`:268-269`)          | Cheap projection of the one ordered batch stream.                                                                                                                                                            |
| `FetchRunCommitReceipt.executionAttemptId` (`:296`)           | Attribution of the attempt that applied a batch. Receipt replay is keyed by run + batch identity/content, so replay survives attempt takeover without authorizing new writes.                                |

`dispatchMeta` remains inside `FetchRun.queries` only for the pre-`start` AU
dispatch claim/idempotency window. It is not an execution lease once `start`
has populated the fields above.

This is now the **only** attempt-fenced projection in the schema. The
TailoringRun acceptance projection — attempt fences, required/accepted target
masks, `issueKey`/`issueHash`, `promptReceipts` and both receipt tables — was
dropped with ADR-0022.

### Application publication projection

ADR-0020's document-level half survives whole; only the receipt fence around it
died.

| Field                                                    | Authority                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `resumeContentHash` / `coverContentHash` (`:384-385`)    | Render-effective content identity for each target, computed from canonical `aiContent` plus the render context.  |
| `resumePublishedHash` / `coverPublishedHash` (`:387-388`) | The content identity the current target PDF pointer actually represents.                                        |
| `status` (`:380`)                                        | Compatibility projection: `FINAL` only when every present target is independently current.                      |

`transitionApplicationPublication` is the single writer of that pair, and
`applicationPublicationReplay.ts` reads it so a repeated `/finalize` click is a
read rather than another compile.

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
| `FetchRunCommitReceipt.fetchRun`    | `FetchRun`              | Cascade      | `293` |
| `ActiveResumeProfile.resumeProfile` | `ResumeProfile`         | Cascade      | `343` |
| `Application.job`                   | `Job?`                  | **SetNull**  | `357` |
| `Application.resumeProfile`         | `ResumeProfile?`        | **SetNull**  | `360` |
| `ApplicationEvent.job`              | `Job?`                  | **SetNull**  | `474` |
| `ApplicationEvent.application`      | `Application?`          | **SetNull**  | `476` |
| `EvidenceSnapshot.application`      | `Application?`          | **SetNull**  | `516` |
| `EvidenceSnapshot.job`              | `Job?`                  | **SetNull**  | `518` |
| `ClaimEvidence.application`         | `Application`           | Cascade      | `542` |
| `ClaimEvidence.evidenceSnapshot`    | `EvidenceSnapshot`      | **Restrict** | `544` |

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

1. Take the per-user Job mutation lock first (`:207`).
2. Read the owned Job; `null` returns `{alreadyDeleted: true}`.
3. Row-lock the owned Job ids in stable order (`:215`).
4. Take the Application mutation lock before reading artifact pointers (`:219`).
5. Upsert the canonical `DeletedJobUrl` tombstone (`:232`).
6. In the same transaction, convert the four current artifact pointers into
   durable `ApplicationArtifact.DELETE_PENDING` work.
7. Capture the Application's content-addressed EvidenceSnapshot ids, delete the
   Application (`:247`), then remove only candidate snapshots with no surviving
   claims (`:190`). Captured ids let the final shared reference be reclaimed
   even when an older Job deletion already set the snapshot's `jobId` to null.
8. Delete the owned Job row (`:256`).
9. Return `artifactRetirement.queued`; the protected reconciler owns the later
   Blob call and fenced settlement. The deprecated `blobCleanup` projection is
   retained additively for API compatibility while clients migrate.

Batch-header reconciliation and the ABAT lock step went with the queue
(ADR-0022); the row-lock in step 3 remains as the stable-order fence for the
Application locks that follow.

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
`jobImportService.ts:194-202`.

- **Writers**: two, both inside the delete transaction — `jobDeleteService.ts:232`
  (upsert) and `:323` (createMany).
- **Reader**: one — `jobImportService.ts:225`.
- **No delete path exists.** A tombstone is permanent for the life of the user
  row. The retired `/api/jobs/bulk-ignore` route moved `NEW → REJECTED` for the
  same reason; the reversible triage path is still a status write, not a delete.

Import dedupes in three layers: an in-payload `Set` (`:147`), the tombstone
exclusion (`excludeTombstonedJobs`, `:220-233`, with stored values
re-canonicalized at `:232-233` so rows written before a canonicalizer change
still match), and `@@unique([userId, jobUrl])` + `skipDuplicates` (`:311`).
`prepareJobImportForUser` deliberately stops before any tombstone read;
`persistPreparedJobImport` takes the job mutation lock as its first statement
(`:337`) and only then filters and inserts, so a delete cannot commit a
tombstone between the read and the inserts.

`canonicalizeJobUrl` (`lib/shared/canonicalizeJobUrl.ts:59`) strips `www.`, folds
LinkedIn subdomains, drops default ports, resolves a LinkedIn job id from the
path or query and rewrites to a canonical form, and keeps at most one stable
identity query param. It returns `""` on any parse failure. The same function is
used on both the delete and import sides so tombstone and Job identities cannot
diverge.

---

## Enums

10 enums: `JobStatus`, `ApplicationEventType`, `ApplicationEventSource`,
`EvidenceKind`, `JobLivenessStatus`, `FetchRunStatus`, `OnboardingStage`,
`ApplicationStatus`, `ApplicationArtifactTarget`, `ApplicationArtifactState`.
Workflow state is grouped across Job/Application events, FetchRun, and the
Application Artifact lifecycle.
`ApplicationArtifactTarget` and `ApplicationArtifactState` establish the
stage/reference/retirement vocabulary used by the artifact lifecycle module
and reconciler. Historical enum members such as `ApplicationEventSource =
EXTENSION` remain readable audit values; they do not imply an active browser
extension writer.

The seven batch/Tailoring Run enums, including `ApplicationBatchScope`, were
dropped with their tables in
`20260811090000_drop_runner_queue_and_tailoring_runs`.

`EvidenceKind` declares seven members; only `RESUME_PROFILE` and
`JOB_DESCRIPTION` are ever written.

### The ADR-0007 job-status projection

All seven values stay in the enum because `ApplicationEvent.fromStatus`/`toStatus`
record history verbatim.

- **Stored**: seven.
- **Surfaced**: `ACTIVE_JOB_STATUS_VALUES = ["NEW","APPLIED","REJECTED"]` — `lib/shared/jobStatus.ts:24`
- **Projection**: `INTERVIEW`/`OFFER`/`ACCEPTED` → `APPLIED`, `WITHDRAWN` → `REJECTED`; unknown → `NEW` — `jobStatus.ts:40-45`, `:77`
- **Transitions**: `canTransitionJobStatus` projects the source and rejects any non-active target — `:83-95`

`toActiveJobStatus` is applied at four call sites, all client-side:
`jobsQueryCache.ts:23`, `jobsUrlState.ts:37`, `jobStatusPresentation.ts:64`,
and `serializeJobListItem.ts:25`. **It is not applied on any server read
path** — `jobListService.ts:149` selects `status` raw. Enforcement elsewhere is
at the API boundary: the list filter accepts all seven, status writes accept
only the three active values, and the transition gate rejects the rest.

---

## JSON columns

| Column                                                               | Shape                                                                                                             | Validated by                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Job.postingRiskFlags`                                               | `string[]` advisory flags                                                                                         | **Nothing** — coerced by `normalizePostingRiskFlags`                                                                                                                                                                   |
| `FetchRun.queries`                                                   | Versioned AU execution config plus pre-start dispatch/idempotency metadata (`:274`)                               | Strict AU v2 writer and historical AU v1 reader; non-AU and unknown versions fail closed. Authoritative post-start lease fields are relational, not JSON                                                               |
| `ResumeProfile.{basics,links,skills,experiences,projects,education}` | Master Resume Profile sections                                                                                    | `ResumeProfileSchema` — `lib/shared/schemas/resumeProfile.ts`                                                                                                                                                          |
| `Application.aiContent`                                              | **AI Content** — the ADR-0001 current-proposal snapshot with per-target provenance plus aggregate evidence/review | `aiContentSchema` — `lib/shared/schemas/aiContent.ts`, `.strict()`. Target provenance is optional for legacy v1 rows; a missing entry means unknown. The retired `skillsAdditions` key is stripped by a `z.preprocess` |
| `Application.atsValidation`                                          | Last ATS/PDF machine-readability result                                                                           | **Nothing** — written as an object literal, read back through a `typeof` guard                                                                                                                                         |
| `Application.reviewReport`                                           | Reviewer report; the same object also lives at `aiContent.review`                                                 | `applicationReviewSchema` on write; **no server-side parse of the stored column**                                                                                                                                      |
| `ApplicationEvent.metadata`                                          | Arbitrary payload                                                                                                 | **Nothing**                                                                                                                                                                                                            |
| `EvidenceSnapshot.payload`                                           | `{path, excerpt}`                                                                                                 | **Nothing** — and nothing reads it back                                                                                                                                                                                |
| `PromptRuleTemplate.{cvRules,coverRules,hardConstraints}`            | Skill Pack rule lists                                                                                             | **Nothing** — typed `unknown`, coerced by `normalizeRuleList`                                                                                                                                                          |
| `OnboardingState.checklist`                                          | Five boolean flags                                                                                                | The **patch** is validated, not the stored column                                                                                                                                                                      |
| `DiscoverCache.payload`                                              | Namespaced trending cache blob                                                                                    | **Nothing** — cast on write and read                                                                                                                                                                                   |

---

## Constraints that encode a domain rule

| Constraint                                                                                                          | Rule                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Job @@unique([userId, jobUrl])` (`:207`)                                                                           | A Job is identified within a user by its canonical `jobUrl`. With `skipDuplicates` this makes import idempotent with no find-then-create race.                                                                                                                                      |
| `DeletedJobUrl @@unique([userId, jobUrl])` (`:231`)                                                                 | One tombstone per user per URL; makes both delete paths idempotent.                                                                                                                                                                                                                 |
| `FetchRunCommitReceipt @@unique([fetchRunId, batchKey])` (`:306`) and `@@unique([fetchRunId, batchIndex])` (`:307`) | One request identity and one ordered slot per run; same-content retries replay across attempts, while conflicting content or order fails closed. The receipt's `executionAttemptId` is attribution, not part of either unique key.                                                  |
| `Application @@unique([userId, jobId])` (`:401`)                                                                    | One Application per `(userId, jobId)`. Note `jobId` is nullable and Postgres treats NULLs as distinct, so this does not bound orphaned Applications.                                                                                                                                |
| `ActiveResumeProfile @@id([userId, locale])` (`:347`)                                                               | Exactly one active Master Resume Profile per `(user, Resume Locale)` — enforced as the primary key, so upsert is the only way to move the pointer.                                                                                                                                  |
| `ApplicationEvent @@unique([userId, idempotencyKey])` (`:493`)                                                      | Replay safety for the status ledger. A reused key with a different payload raises `IDEMPOTENCY_KEY_REUSED`.                                                                                                                                                                         |
| `EvidenceSnapshot @@unique([userId, contentHash, kind])` (`:528`)                                                   | Content-addressed reuse — identical evidence within one tenant is reused, not copied.                                                                                                                                                                                               |
| `ClaimEvidence @@unique([applicationId, claimHash, evidenceSnapshotId])` (`:552`)                                   | Claim edges are append-only and idempotent; a retry cannot duplicate the audit trail.                                                                                                                                                                                               |
| `ApplicationArtifact.storageIdentity @unique` (`:421`) / `provisionalIdentity @unique` (`:424`)                     | One canonical physical identity per recorded object and one upload reservation per immutable pathname. Pathname and URL presentation aliases are deliberately non-unique. SQL checks also enforce non-negative retries, paired claims/leases, and state-compatible nullable fields. |
| `Job.companyRoleKey` — **index, deliberately not unique** (`:214`)                                                  | A soft "same opening" hint. Distinct openings can collide, so it powers a possible-duplicate badge and never an automatic removal.                                                                                                                                                  |
| `Job.descriptionSimHash` — **index only** (`:215`)                                                                  | Advisory 64-bit SimHash near-duplicate detection. It is never used as a unique key.                                                                                                                                                                                                 |
| Trigram GIN on `Job.title/company/location` (`:218-220`)                                                            | Declared in the model as `type: Gin` with `raw("gin_trgm_ops")`. The `pg_trgm` extension itself is installed by raw SQL in `20260330000000_search_optimization`, not by Prisma. Powers the ILIKE relevance path.                                                                    |

The batch and Tailoring Run constraints — `ApplicationBatchTask`'s
`@@unique([batchId, jobId])`, the raw-SQL one-active-batch-per-user index,
`TailoringRun`'s `@@unique([userId, issueKey])` and
`applicationBatchTaskId @unique`, both receipt tables' `@@unique([runId, target])`,
and `AgentCredential.tokenHash @unique` — were dropped with their tables in
`20260811090000_drop_runner_queue_and_tailoring_runs`.

---

## Advisory locks

The named critical sections use `pg_advisory_xact_lock` via `$executeRaw`; that
function returns `void`, which driver adapters cannot deserialize through
`$queryRaw`. The FetchRun dispatch guard is intentionally different: it uses
`pg_try_advisory_xact_lock` through `$queryRaw` because its boolean result is
the interface.

`lib/server/db/advisoryLock.ts` centralizes the `FRUN`, `JOBJ`, and `JOBA`
namespaces, their shared FNV-1a key (`stableInt32`, `:32`), and the required
broad-to-narrow order. `JOBC` remains local to its owning module; changing any
key derivation is a rolling-deployment compatibility change, not a refactor.

| Namespace           | Constant                                                                | Key                                 | Taken by                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOBJ` `0x4a4f424a` | `db/advisoryLock.ts`, adapter `jobs/jobMutationLock.ts`                 | `stableInt32(userId)`               | `deleteJob`, `batchDeleteJobs`, `persistPreparedJobImport` — serializes generic and FetchRun imports against permanent delete                                  |
| `JOBA` `0x4a4f4241` | `db/advisoryLock.ts`, adapter `applications/applicationMutationLock.ts` | `stableInt32("${userId}:${jobId}")` | Both delete paths, `manual-generate`, `draft`, `finalize`, `discard`                                                                                           |
| `JOBC` `0x4a4f4243` | `applications/applicationEvents.ts:47`                                  | same                                | `appendApplicationEvent`, in a `Serializable` transaction. `bulkAppendStatusEvents` takes **no** advisory lock — its boundary is `updateManyAndReturn`         |
| `FRUN` `0x4652554e` | `db/advisoryLock.ts`, adapter `fetchRuns/fetchRunLifecycleLock.ts`      | `stableInt32(runId)`                | Attempt `start`/takeover, commit, fail, stale recovery, and cancel. It serializes changes to the relational attempt fence and is always acquired before `JOBJ` |

The `ABAT` and `TLRN` namespaces went with `lib/server/tailoringRuns/**`
(ADR-0022), and the `SHRC` source-health namespace with ADR-0017. All three
appear only in historical migration/ADR evidence; no live module owns them.

One non-namespaced lock uses the single-`bigint` form:
`fetchRunLifecycleLock.ts` also exposes the trigger's
`pg_try_advisory_xact_lock` with a djb2 hash masked to 31 bits (collisions
documented as acceptable), and
`discoverCache.ts` uses no advisory lock at all — its writes are row-level
lease fenced by a random `ownerToken` (ADR-0005).

---

## Migration history

62 migrations, `20260114042057_init_auth_jobs` →
`20260811090000_drop_runner_queue_and_tailoring_runs`.
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
| `20260720171000_add_career_lifecycle`                             | 331 lines, 8 enums and 8 tables — the ledger, global `SourceHealth`/`AtsBoardSource`, and the four tables ADR-0006 later retained. Later contract migrations removed every retired table after its writer and data gates converged.                                 |
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
| `20260808120000_rename_discover_cache_drop_video_rows`            | Renames the surviving GitHub-trending cache to `DiscoverCache`, preserves its physical constraint/index names, and deletes retired video/refresh payloads.                                                                                                          |
| `20260809154500_drop_retired_source_tables`                       | ADR-0017 Stage 2: locks and rechecks legacy-row, orphan-Artifact, and Blob-inventory readiness, then drops `AtsBoardSource`, `SourceHealth`, and `SourceHealthStatus` without `CASCADE`.                                                                            |
| `20260809161000_verify_post_retirement_inventory`                 | Deployment fence: requires a settled Blob inventory whose completion is later than the source-contract migration, then rechecks legacy rows and active orphan Artifacts before the Stage 2 binary may replace Stage 1.                                              |
| `20260809190000_retire_fit_scoring`                               | ADR-0019: drops the Fit queue tables (`FitBatchClaim`, `FitBatchClaimItem`, `FitBatchImportReceipt`), their enums, and the seven `Job.fit*` columns; the deterministic JD analysis and posting risk stay.                                                            |
| `20260810113000_durable_tailoring_publication`                    | ADR-0020: adds independent required/published target masks, protocol-v2 task constraints, and immutable target publication receipts so DRAFT acceptance and PDF publication recover independently. Its document-level half survives; the receipt half was dropped a day later.      |
| `20260811090000_drop_runner_queue_and_tailoring_runs`             | ADR-0022: drops `TailoringRunPublicationReceipt`, `TailoringRunReceipt`, `TailoringRun`, `ApplicationBatchTask`, `ApplicationBatch` and `AgentCredential` in dependency order, plus their seven enums. Dropping `AgentCredential` is the revocation for every token ever minted.     |
| `20260330000000_search_optimization`                              | The only Postgres-extension-installing migration: `pg_trgm` plus three GIN indexes.                                                                                                                                                                                 |

After editing `prisma/schema.prisma`, run `npx prisma generate`.
