# Data — `prisma/schema.prisma`

31 models, 19 enums, 48 migrations. Client generates to `lib/generated/prisma`
and is reached through the singleton in `lib/server/prisma.ts:13` over
`PrismaNeon`. Vocabulary is `CONTEXT.md`.

---

## Model inventory

| Model (line) | Domain meaning | Status |
|---|---|---|
| `User` (`:156`) | Tenant root, OAuth identity | Live — adapter-owned |
| `Account` (`:193`), `Session` (`:217`) | NextAuth records | Live — adapter-owned |
| `Job` (`:230`) | A **Job** from the Fetch Pipeline | Live |
| `ApplicationBatch` (`:308`) | A **Codex Batch** run header | Live |
| `ApplicationBatchTask` (`:329`) | One Job's slot in a batch | Live |
| `TailoringRun` (`:358`) | Durable execution/fencing identity for one issued Application tailoring operation | Live |
| `TailoringRunReceipt` (`:411`) | Immutable per-target acceptance receipt | Live, append-only |
| `DeletedJobUrl` (`:431`) | Tombstone for a canonical `jobUrl` the user deleted | Live |
| `DailyCheckin` (`:443`) | Per-local-date triage streak | Live |
| `FetchRun` (`:455`) | A Fetch Pipeline task | Live |
| `FetchRunCommitReceipt` (`:498`) | Durable idempotency receipt for one ordered FetchRun batch and applying attempt | Live, append-only |
| `ResumeProfile` (`:519`) | A **Master Resume Profile**, per name per Resume Locale | Live |
| `ActiveResumeProfile` (`:547`) | Pointer to the active profile per `(userId, locale)` | Live |
| `Application` (`:560`) | The **Application** for one `(userId, jobId)` | Live |
| `ApplicationEvent` (`:611`) | Immutable status ledger — the source of truth per ADR-0007 | Live, append-only |
| `EvidenceSnapshot` (`:652`) | Content-addressed evidence backing AI claims | **Written, never read** |
| `ClaimEvidence` (`:679`) | Claim → evidence edge | **Written, never read** |
| `InterviewPlan` (`:702`) | Retired Career workspace | **ADR-0006 retained, no writers** |
| `StarStory` (`:724`) | Retired Career workspace | **ADR-0006 retained, no writers** |
| `Offer` (`:748`) | Retired Career workspace | **ADR-0006 retained, no writers** |
| `FollowUpReminder` (`:778`) | Retired Career workspace | **ADR-0006 retained, no writers** |
| `PromptRuleTemplate` (`:802`) | Per-user **Skill Pack** rule set | Live |
| `ExtensionToken` (`:822`) | Extension bearer token, SHA-256 hash only | Live |
| `FormSubmission` (`:838`) | Extension-captured ATS form submission | Live |
| `FieldMappingRule` (`:861`) | Learned autofill selector → profile path | Live |
| `OnboardingState` (`:886`) | Onboarding checklist and stage | Live |
| `DiscoverVideoCache` (`:906`) | Global Discover cache + daily-refresh lease (ADR-0005) | Live |
| `LocalAiSetting` (`:918`) | Non-secret local-AI endpoint per user (ADR-0004) | Live |
| `SourceHealth` (`:928`) | Global per-source status/counters/timestamps | Live — upserted by `sourceHealthStore.ts`, read through `readSourceHealth.ts` |
| `AtsBoardSource` (`:943`) | Global ATS board registry | Live — **no insert path in TypeScript**; DB rows require external provisioning, while `JOBLIT_ATS_BOARDS_JSON` remains runtime-only |

The four retained-without-writers models carry a block comment at
`schema.prisma:589-591`; the decision is ADR-0006 lines 21-23. `EvidenceSnapshot`
and `ClaimEvidence` are **not** in that group — they still receive writes from
`persistReviewLedger.ts:72` and `:118`.

---

## Ownership and tenancy

25 models carry `userId String @db.Uuid` with a `Cascade` FK to `User`. Three use
it as the key rather than a column: `ActiveResumeProfile` (`@@id([userId, locale])`
at `:448`),
`OnboardingState` (`userId @unique`), `LocalAiSetting` (`userId @id`).

`ApplicationBatchTask` and `ClaimEvidence` carry both a parent id and a
denormalised `userId`, so a tenant filter never needs a join.
`FetchRunCommitReceipt` and `TailoringRunReceipt` deliberately scope ownership
through their required run parent; commit callers never supply a tenant id.

Three models are global: `DiscoverVideoCache` (`key @id`), `SourceHealth`
(`source @id`, deliberate per the comment at `:817`), `AtsBoardSource`.

| Family | Scoping |
|---|---|
| Jobs | `where: {userId, …}` — `jobListService.ts:122-127`; raw SQL injects `j."userId"` at `jobSearchService.ts:119` |
| Applications | Composite `userId_jobId`, or `findFirst({where:{id, userId}})` |
| Tailoring runs | `TailoringRun.userId`; receipts inherit ownership through their required run |
| Resume profiles | `where: {userId, locale}`; active pointer via `userId_locale` |
| Extension | `ExtensionToken.tokenHash` → `userId` at `requireExtensionToken.ts:40` |

Ownership sits in the **write predicate**, not only the read:
`jobDeleteService.ts:107` and `:188` keep `userId` inside the `deleteMany`.

### FetchRun execution projection

| Field | Authority |
|---|---|
| `FetchRun.userId` (`:350`) | Sole tenant authority for config reads and commits. |
| `FetchRun.userEmail` (`:355`) | Nullable pre-v1 compatibility snapshot. New code neither writes nor reads it; deletion waits for a separate contract migration after the rollback window. |
| `executionAttemptId` + `executionLeaseExpiresAt` (`:371-372`) | Current executor fence and takeover deadline. The migration check requires both to be null or both non-null. Lease expiry permits a new `start`; it does not revoke the current UUID until takeover commits. |
| `expectedBatchCount` + `nextBatchIndex` (`:369-370`) | Cheap projection of the one ordered batch stream. |
| `FetchRunCommitReceipt.executionAttemptId` (`:397`) | Attribution of the attempt that applied a batch. Receipt replay is keyed by run + batch identity/content, so replay survives attempt takeover without authorizing new writes. |

`dispatchMeta` remains inside `FetchRun.queries` only for pre-`start` dispatch
claim/idempotency and the rolling fallback for RUNNING inline rows with no
relational attempt. It is not an execution lease once `start` has populated
the fields above.

### TailoringRun acceptance projection

| Field | Authority |
|---|---|
| `TailoringRun.executionAttemptId` + `executionLeaseExpiresAt` | Current executor fence and takeover deadline. A stale attempt cannot accept new output after takeover. |
| `requiredTargetMask` + `acceptedTargetMask` | Required and durably accepted Resume/Cover projection. |
| `issueKey` + `issueHash` | Idempotent issuance identity; same key with different issued inputs is rejected. |
| `promptReceipts` + snapshot hashes | Bind accepted output to the issued prompt/profile/job without storing full prompts or model output. |
| `TailoringRunReceipt` | Immutable evidence for one `(run, target)` acceptance. Exact replay returns the receipt; conflicting content is rejected. |
| `ApplicationBatchTask.executionAttemptId` | Batch-side projection of the same active attempt. |
| `tailoringProtocolVersion` + `completionAttemptId` | Historical rows remain v0. A v1 claim upgrades atomically and clears proof; v1 success is database-valid only when the final receipt writes `completionAttemptId = executionAttemptId`. |

---

## Cascade and deletion

Selected relations. `Cascade` from `User` is universal and omitted here.

| Child.field | Parent | Rule | Line |
|---|---|---|---|
| `ApplicationBatchTask.batch` | `ApplicationBatch` | Cascade | `304` |
| `ApplicationBatchTask.job` | `Job` | Cascade | `308` |
| `TailoringRun.applicationBatchTask` | `ApplicationBatchTask?` | SetNull | `369` |
| `TailoringRun.resumeProfile` | `ResumeProfile?` | SetNull | `366` |
| `TailoringRun.application` | `Application?` | SetNull | `372` |
| `TailoringRunReceipt.run` | `TailoringRun` | Cascade | `414` |
| `TailoringRunReceipt.application` | `Application?` | SetNull | `420` |
| `FetchRunCommitReceipt.fetchRun` | `FetchRun` | Cascade | `394` |
| `ActiveResumeProfile.resumeProfile` | `ResumeProfile` | Cascade | `444` |
| `Application.job` | `Job?` | **SetNull** | `458` |
| `Application.resumeProfile` | `ResumeProfile?` | **SetNull** | `461` |
| `ApplicationEvent.job` | `Job?` | **SetNull** | `506` |
| `ApplicationEvent.application` | `Application?` | **SetNull** | `508` |
| `EvidenceSnapshot.application` | `Application?` | **SetNull** | `547` |
| `EvidenceSnapshot.job` | `Job?` | **SetNull** | `549` |
| `ClaimEvidence.application` | `Application` | Cascade | `574` |
| `ClaimEvidence.evidenceSnapshot` | `EvidenceSnapshot` | **Restrict** | `576` |
| `StarStory.sourceEvidence` | `EvidenceSnapshot?` | SetNull | `629` |
| `FormSubmission.job` | `Job?` | SetNull | `734` |

`ClaimEvidence.evidenceSnapshot` is the only `Restrict` in the schema.

### What `jobDeleteService.ts` actually does

`deleteJob(userId, jobId)` — one transaction, 30 s timeout:

1. `acquireJobMutationLock(tx, userId)` — `:77`, deliberately first
2. `tx.job.findFirst({id, userId})` — `:79`; `null` → `{alreadyDeleted: true}`
3. `acquireApplicationMutationLock(tx, userId, job.id)` — `:87`
4. Read the four Blob URLs — `:88`
5. `canonicalizeJobUrl(job.jobUrl)` — `:97`
6. `tx.deletedJobUrl.upsert` with an empty `update: {}` so re-deleting does not move `deletedAt` — `:98`
7. `tx.application.deleteMany({userId, jobId})` — `:103`
8. `tx.job.deleteMany({id, userId})` — `:106`
9. **Outside** the transaction: delete the Blob objects — `:131`

`batchDeleteJobs` is the same shape, taking Application locks in **sorted id
order** (`:160-165`) and using one `createMany({skipDuplicates: true})` for the
tombstones.

### Rows that survive with every non-user FK null

Three, all reachable from an ordinary delete:

1. **`EvidenceSnapshot`** — `applicationId` and `jobId` both become NULL. Nothing
   reads the table, so nothing re-links it; it is removed only when the `User`
   row goes. The payload holds the JD excerpt and resume claims. The service
   deletes four Blob artifacts with a retry fallback and does not touch this.
2. **`ApplicationEvent`** — designed for it. `companySnapshot` and `titleSnapshot`
   (`:510-513`) exist so the row stays meaningful after the Job is gone, and
   `applicationCooldownService.ts:103` reads them.
3. **`FormSubmission`** — `pageUrl` / `pageDomain` / `formSignature` remain as
   the only identity.

The contrast between 1 and 2 is the point: `ApplicationEvent` documents its
reader, `EvidenceSnapshot` does not.

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

19 enums. Referenced by generated name in TypeScript: `JobStatus`,
`FetchRunStatus`, `ApplicationBatchStatus`, `ApplicationBatchTaskStatus`. The
other 15 are
duplicated as inline string unions or literals — including `ApplicationStatus`
(`DRAFT | FINAL`) and the four Tailoring Run enums.

Enums with no TypeScript reference at all: `InterviewPlanStatus`, `OfferStatus`,
`FollowUpReminderType` (ADR-0006 retained), and `ApplicationBatchScope` (one
member, `NEW`, used only as a schema default).

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

| Column | Shape | Validated by |
|---|---|---|
| `Job.fitMatrix` | AI requirement matrix; score aggregated deterministically | `FitMatrixSchema` — `lib/shared/schemas/fitMatrix.ts:53` |
| `Job.postingRiskFlags` | `string[]` advisory flags | **Nothing** — coerced by `normalizePostingRiskFlags` |
| `FetchRun.queries` | Versioned market-specific execution config plus pre-start dispatch/idempotency metadata (`:375`) | Strict `FetchRunConfigV1Schema` for v1 rows; `normalizeFetchRunConfigV1` upgrades historical shapes—including GLOBAL source-only rows—at the execution boundary and fails closed for invalid versioned rows. Authoritative post-start lease fields are relational, not JSON |
| `TailoringRun.promptReceipts` | Target-keyed prompt identity only; never full prompt bytes or raw model output | `normalizePromptReceipts` on issue and `readPromptReceipts` on lifecycle/acceptance reads |
| `ResumeProfile.{basics,links,skills,experiences,projects,education}` | Master Resume Profile sections | `ResumeProfileSchema` — `lib/shared/schemas/resumeProfile.ts:72` |
| `Application.aiContent` | **AI Content** — the ADR-0001 current-proposal snapshot with per-target provenance plus aggregate evidence/review | `aiContentSchema` — `lib/shared/schemas/aiContent.ts`, `.strict()`. Target provenance is optional for legacy v1 rows; a missing entry means unknown. The retired `skillsAdditions` key is stripped by a `z.preprocess` |
| `Application.atsValidation` | Last ATS/PDF machine-readability result | **Nothing** — written as an object literal, read back through a `typeof` guard |
| `Application.reviewReport` | Reviewer report; the same object also lives at `aiContent.review` | `applicationReviewSchema` on write; **no server-side parse of the stored column** |
| `ApplicationEvent.metadata` | Arbitrary payload | **Nothing** |
| `EvidenceSnapshot.payload` | `{path, excerpt}` | **Nothing** — and nothing reads it back |
| `PromptRuleTemplate.{cvRules,coverRules,hardConstraints}` | Skill Pack rule lists | **Nothing** — typed `unknown`, coerced by `normalizeRuleList` |
| `OnboardingState.checklist` | Five boolean flags | The **patch** is validated, not the stored column |
| `FormSubmission.{fieldValues,fieldMappings}` | Captured ATS form data | `lib/server/extensionSubmissionPayload.ts:134`, `:139`, with entry-count and byte-size caps |
| `DiscoverVideoCache.payload` | Namespaced cache blob or the daily-claim lease | **Nothing** — cast on write and read |

---

## Constraints that encode a domain rule

| Constraint | Rule |
|---|---|
| `Job @@unique([userId, jobUrl])` (`:266`) | A Job is identified within a user by its canonical `jobUrl`. With `skipDuplicates` this makes import idempotent with no find-then-create race. |
| `DeletedJobUrl @@unique([userId, jobUrl])` (`:332`) | One tombstone per user per URL; makes both delete paths idempotent. |
| `FetchRunCommitReceipt @@unique([fetchRunId, batchKey])` (`:407`) and `@@unique([fetchRunId, batchIndex])` (`:408`) | One request identity and one ordered slot per run; same-content retries replay across attempts, while conflicting content or order fails closed. The receipt's `executionAttemptId` is attribution, not part of either unique key. |
| `Application @@unique([userId, jobId])` (`:494`) | One Application per `(userId, jobId)`. Note `jobId` is nullable and Postgres treats NULLs as distinct, so this does not bound orphaned Applications. |
| `ActiveResumeProfile @@id([userId, locale])` (`:448`) | Exactly one active Master Resume Profile per `(user, Resume Locale)` — enforced as the primary key, so upsert is the only way to move the pointer. |
| `ApplicationEvent @@unique([userId, idempotencyKey])` (`:525`) | Replay safety for the status ledger. A reused key with a different payload raises `IDEMPOTENCY_KEY_REUSED`. |
| `EvidenceSnapshot @@unique([userId, contentHash, kind])` (`:560`) | Content-addressed reuse — identical evidence within one tenant is reused, not copied. |
| `ClaimEvidence @@unique([applicationId, claimHash, evidenceSnapshotId])` (`:584`) | Claim edges are append-only and idempotent; a retry cannot duplicate the audit trail. |
| `ApplicationBatchTask @@unique([batchId, jobId])` (`:319`) | A Job appears at most once per batch. |
| `TailoringRun @@unique([userId, issueKey])` (`:403`) | Issuing the same operation is idempotent within a tenant; `issueHash` detects conflicting reuse. |
| `TailoringRun.applicationBatchTaskId @unique` (`:368`) | A batch task has at most one Tailoring Run. |
| `TailoringRunReceipt @@unique([runId, target])` (`:425`) | At most one immutable acceptance receipt per target; exact retries replay it. |
| `FieldMappingRule @@unique([userId, fieldSelector, atsProvider, pageDomain])` (`:771`) | One learned mapping per selector per ATS and domain. `atsProvider` and `pageDomain` are `NOT NULL DEFAULT ''` **because** nullable columns made the upsert never match — see `20260405000000_fix_field_mapping_nullable_unique`. |
| `ExtensionToken.tokenHash @unique` (`:717`) | Lookup by hash only; the raw token is never stored. |
| `Job.companyRoleKey` — **index, deliberately not unique** (`:274`) | A soft "same opening" hint. Distinct openings can collide (`:240-242`), so it powers a possible-duplicate badge and never an automatic removal. |
| `Job.descriptionSimHash` — **index only** (`:275`) | Advisory 64-bit SimHash near-duplicate detection. "Never used as a unique key" (`:245`). |
| Trigram GIN on `Job.title/company/location` | Created by raw SQL in `20260330000000_search_optimization`, not by Prisma. Exists in the database but not in the model — flagged at `:264`. Powers the ILIKE relevance path. |

---

## Advisory locks

All use `pg_advisory_xact_lock` via `$executeRaw` — never `$queryRaw`, because
the function returns `void`, which driver adapters cannot deserialize.

Eight of nine derive the key with an FNV-1a 32-bit `stableInt32`, **duplicated
verbatim in each module**.

| Namespace | Constant | Key | Taken by |
|---|---|---|---|
| `JOBJ` `0x4a4f424a` | `jobs/jobMutationLock.ts:5` | `stableInt32(userId)` | `deleteJob`, `batchDeleteJobs`, `persistPreparedJobImport` — serializes generic and FetchRun imports against permanent delete |
| `JOBA` `0x4a4f4241` | `applications/applicationMutationLock.ts:5` | `stableInt32("${userId}:${jobId}")` | Both delete paths, `generateApplicationArtifacts`, `manual-generate`, `draft`, `finalize` (×2), `discard` |
| `JOBC` `0x4a4f4243` | `applications/applicationEvents.ts:31` | same | `appendApplicationEvent`, in a `Serializable` transaction. `bulkAppendStatusEvents` takes **no** advisory lock — its boundary is `updateManyAndReturn` |
| `JOBF` `0x4a4f4246` | `jobs/fitRunService.ts:23` | `stableInt32(userId)` | `nextFitBatch` — leases the next triage batch |
| `JOBL`/`FTCH` | `fetchRuns/fetchRunQuota.ts:35` | **Fixed** global key | `checkFetchRunQuota`; stale active rows are excluded from capacity, while terminal projection happens separately through the commit module |
| `FRUN` `0x4652554e` | `fetchRuns/fetchRunLifecycleLock.ts:3` | `stableInt32(runId)` | Attempt `start`/takeover, commit, fail, stale recovery, and cancel. It serializes changes to the relational attempt fence and is always acquired before `JOBJ` |
| `ABAT` `0x41424154` | `tailoringRuns/tailoringRunLock.ts:3` | `stableInt32(batchId)` | Batch claim/completion/cancellation and batch-bound Tailoring Run acceptance; first lock in the global acceptance order |
| `TLRN` `0x544c524e` | `tailoringRuns/tailoringRunLock.ts:4` | `stableInt32(runId)` | Tailoring Run issue/start/prompt binding/acceptance/fail/cancel; acquired after `ABAT` and before `JOBA` |
| `SHRC` `0x53485243` | `sources/sourceHealthStore.ts:11` | per source, all acquired in one roundtrip via a `MATERIALIZED` CTE so the planner cannot hoist the lock ahead of the sort | `persistSourceHealthDiagnostics` |

Two non-namespaced locks use the single-`bigint` form:
`fetchRunLifecycleLock.ts` also exposes the trigger's
`pg_try_advisory_xact_lock` with a djb2 hash masked to 31 bits (collisions
documented as acceptable), and
`discoverCache.ts` uses no advisory lock at all — its daily claim is a row-level
lease fenced by a random `ownerToken` (ADR-0005).

---

## Migration history

48 migrations, `20260114042057_init_auth_jobs` →
`20260726090000_tailoring_run_acceptance_protocol`.
Most are a single additive `ALTER TABLE`. The ones that changed a domain rule:

| Migration | Change |
|---|---|
| `20260118091027_add_deleted_job_urls` | Introduced the tombstone. Deleting a Job became permanent for re-import. |
| `20260218170000_resume_profile_user_unique` | **Data-destructive.** Deleted all but the newest profile per user, then enforced one Master Resume Profile per user. |
| `20260221124000_add_multi_resume_profiles` | Reversed that rule: added `name` + `revision` and `ActiveResumeProfile`. |
| `20260719093000_drop_legacy_resume_profile_user_unique` | Four lines. Prisma's `DROP CONSTRAINT` had left the standalone index, so multi-profile was still blocked at the database level. |
| `20260308120000_add_market_and_locale_fields` | Added Market and Resume Locale. Also added `Application.locale`, a column no longer in the schema and never dropped. |
| `20260308223201_add_locale_to_active_resume_profile` | Moved the active-profile key to `(userId, locale)`. |
| `20260509000000_add_application_edit_workflow` | ADR-0001 / ADR-0002: the `ApplicationStatus` enum, `aiContent`, `aiContentHash`. Pre-existing rows are treated as finalized with NULL `aiContent`. |
| `20260405000000_fix_field_mapping_nullable_unique` | Backfilled NULL → `''` because `NULL != NULL` made the upsert never match. |
| `20260720171000_add_career_lifecycle` | 331 lines, 8 enums and 8 tables — the ledger, global `SourceHealth`/`AtsBoardSource`, and the four tables ADR-0006 later retained. |
| `20260720170000_extend_job_status` | Four `ADD VALUE`s, kept in their own migration so Postgres never consumes a new enum value in the same transaction. |
| `20260720190000_collapse_job_status` | **Data-only, ADR-0007.** Projects retired statuses. No enum values dropped — that would rewrite `ApplicationEvent` history. |
| `20260724090000_fetch_run_commit_protocol` | ADR-0008: adds `PARTIAL`, ordered-batch counters, UUID attempt + lease pair check, non-negative/range checks, and receipt attempt attribution; makes the legacy `userEmail` snapshot nullable without dropping it. |
| `20260726090000_tailoring_run_acceptance_protocol` | ADR-0009: adds Tailoring Run/Receipt, per-target masks and receipt uniqueness, UUID attempt fences, explicit legacy/v1 batch protocol version, current-attempt completion proof, and additive nullable relations without fabricating historical run evidence. |
| `20260330000000_search_optimization` | The only extension-installing migration: `pg_trgm` plus three GIN indexes. |

After editing `prisma/schema.prisma`, run `npx prisma generate`.
