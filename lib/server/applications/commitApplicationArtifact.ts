import { AppError } from "@/lib/server/api/appError";
import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import {
  evolveApplicationAiContent,
  type ApplicationAiContentReviewContext,
} from "@/lib/server/applications/applicationAiContentAggregate";
import {
  markArtifactsReferencedAndRetireSuperseded,
  recordUploadedArtifact,
  retireStagedArtifacts,
  stageApplicationArtifact,
  type ApplicationArtifactTarget,
} from "@/lib/server/artifacts/applicationArtifactLifecycle";
import { isArtifactBlobPortUnavailable } from "@/lib/server/artifacts/artifactBlobPort";
import { vercelArtifactBlobPort } from "@/lib/server/artifacts/vercelBlobAdapter";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";
import {
  aiContentSchema,
  hashAiContent,
  type AiApplicationReview,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import type { AtsPdfValidation } from "@/lib/server/applications/atsPdfValidator";
import {
  applicationPublicationRecord,
  hashApplicationDocumentContent,
  projectApplicationPublication,
  publicationDocumentContentHashes,
  transitionApplicationPublication,
  UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT,
  type ApplicationPublicationRenderContext,
} from "@/lib/server/applications/applicationPublication";
import {
  applicationPublicationTargets,
  fenceApplicationRenderContext,
} from "./applicationRenderContextFence";

/**
 * Commit a rendered Application artifact.
 *
 *   stage -> upload -> transaction(lock -> read -> merge -> write -> ledger)
 *   -> enqueue superseded artifact for reconciliation
 *
 * Ordering guarantees, none of which a caller can opt out of:
 *
 * - The advisory lock is the first statement of the transaction, so concurrent
 *   CV and cover commits for one Job merge against each other rather than both
 *   overwriting from one stale snapshot.
 * - An upload failure aborts the commit. It never writes a null URL over a
 *   good one -- `manual-generate` used to do exactly that, clearing the user's
 *   previous PDF whenever Blob was briefly unavailable.
 * - If the commit does not land, the staged object is durably queued for
 *   retirement; a process crash cannot erase that cleanup intent.
 * - A superseded object becomes DELETE_PENDING in the same transaction that
 *   moves the Application pointer. Blob deletion happens later through a
 *   leased, claim-fenced reconciler.
 */

export type CommitTarget = "resume" | "cover";

export const APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE = {
  code: "ARTIFACT_STORAGE_UNAVAILABLE",
  status: 503,
  message:
    "PDF storage is not configured. Please try again after deployment configuration is restored.",
} as const;

class DuplicateApplicationArtifactTargetError extends Error {
  readonly code = "DUPLICATE_APPLICATION_ARTIFACT_TARGET";
  /** Deterministic caller error; see ApplicationArtifactConflictError. */
  readonly status = 409;

  constructor(readonly target: CommitTarget) {
    super(`Duplicate application artifact target: ${target}`);
    this.name = "DuplicateApplicationArtifactTargetError";
  }
}

export type CommitArtifact = {
  target: CommitTarget;
  pdf: Buffer;
  filename?: string | null;
  atsValidation?: AtsPdfValidation | null;
};
type VersionedCommitArtifact = CommitArtifact & { version: string };

type CommitBaseFields = {
  userId: string;
  job: { id: string; title: string; company: string | null };
  resumeProfileId: string;
  aiContent: AiContent;
  publicationRenderContext: ApplicationPublicationRenderContext;
  /**
   * Present means compare-and-swap: the write only lands if the row still
   * holds this hash. `null` matches a row that has no AI Content yet.
   * Absent means last-writer-wins under the advisory lock alone.
   */
  expectedHash?: string | null;
  extraData?: Record<string, unknown>;
};

type CommitBaseInput = CommitBaseFields &
  (
    | {
        status: "DRAFT";
        artifacts: [];
      }
    | {
        status: "FINAL";
        artifacts: CommitArtifact[];
      }
  );

export type CommitInput =
  | (CommitBaseInput & {
      /**
       * A single-target proposal is folded into the stored Application under
       * the mutation lock, then the complete aggregate is re-reviewed before
       * it can be persisted.
       */
      mergeTarget: CommitTarget;
      reviewContext: ApplicationAiContentReviewContext;
    })
  | (CommitBaseInput & {
      mergeTarget?: undefined;
      reviewContext?: never;
    });

export type CommitResult =
  | {
      kind: "committed";
      applicationId: string;
      aiContent: AiContent;
      aiContentHash: string;
      publication: ApplicationPublication;
      urls: Partial<Record<CommitTarget, string>>;
    }
  | { kind: "stale_write" }
  | { kind: "stale_render_context" }
  | { kind: "job_missing" }
  | { kind: "invalid_ai_content" }
  | { kind: "review_blocked"; review: AiApplicationReview }
  | { kind: "blob_not_configured" }
  | { kind: "upload_failed"; cause: unknown };

type UploadedArtifact = {
  artifactId: string;
  target: CommitTarget;
  lifecycleTarget: ApplicationArtifactTarget;
  pathname: string;
  url: string;
};

type UploadedArtifactBundle = {
  urls: Partial<Record<CommitTarget, string>>;
  artifacts: UploadedArtifact[];
  stagedArtifactIds: string[];
};

const APPLICATION_COMMIT_SELECT = {
  id: true,
  resumePdfUrl: true,
  coverPdfUrl: true,
  aiContent: true,
  aiContentHash: true,
  atsValidation: true,
  status: true,
  resumeContentHash: true,
  coverContentHash: true,
  resumePublishedHash: true,
  coverPublishedHash: true,
} satisfies Prisma.ApplicationSelect;

type ApplicationCommitRow = Prisma.ApplicationGetPayload<{
  select: typeof APPLICATION_COMMIT_SELECT;
}>;

function lifecycleTarget(target: CommitTarget): ApplicationArtifactTarget {
  return target === "resume" ? "RESUME_PDF" : "COVER_PDF";
}

function blobConfigured(): boolean {
  return getRuntimeCapabilities().blobStorage.kind === "enabled";
}

function findDuplicateArtifactTarget(
  artifacts: readonly CommitArtifact[],
): CommitTarget | null {
  const seen = new Set<CommitTarget>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.target)) return artifact.target;
    seen.add(artifact.target);
  }
  return null;
}

async function scheduleStagedRetirement(input: {
  userId: string;
  jobId: string;
  artifactIds: readonly string[];
}): Promise<void> {
  if (input.artifactIds.length === 0) return;
  // Failure here does not lose the cleanup intent. Every row was durably
  // STAGED before the Blob call, and the expiry reconciler can recover it by
  // pathname even when the upload response itself was lost.
  await retireStagedArtifacts(input).catch(() => undefined);
}

async function uploadStagedArtifact(
  userId: string,
  artifact: VersionedCommitArtifact,
  staged: Awaited<ReturnType<typeof stageApplicationArtifact>>,
): Promise<UploadedArtifact> {
  // An exact retry can reuse the already referenced immutable object without
  // another network call.
  let url = staged.artifact.state === "REFERENCED" ? staged.artifact.url : null;
  if (!url) {
    const blob = await vercelArtifactBlobPort.put({
      pathname: staged.pathname,
      body: artifact.pdf,
      contentType: "application/pdf",
    });
    const recorded = await recordUploadedArtifact({
      artifactId: staged.artifact.id,
      userId,
      pathname: staged.pathname,
      url: blob.url,
    });
    url = recorded.artifact.url;
  }
  if (!url) {
    // The upload reported success without a URL. Nothing downstream can
    // recover, and a 500 here would be replayed against storage that already
    // took the bytes.
    throw new AppError({
      code: "APPLICATION_ARTIFACT_UPLOAD_URL_MISSING",
      status: 502,
      publicMessage:
        "The PDF was uploaded but storage returned no address. Please try again.",
    });
  }
  return {
    artifactId: staged.artifact.id,
    target: artifact.target,
    lifecycleTarget: lifecycleTarget(artifact.target),
    pathname: staged.pathname,
    url,
  };
}

async function uploadArtifacts(
  userId: string,
  jobId: string,
  artifacts: VersionedCommitArtifact[],
): Promise<UploadedArtifactBundle> {
  const urls: Partial<Record<CommitTarget, string>> = {};
  const uploaded: UploadedArtifact[] = [];
  const stagedArtifactIds: string[] = [];
  try {
    for (const artifact of artifacts) {
      const staged = await stageApplicationArtifact({
        userId,
        jobId,
        target: lifecycleTarget(artifact.target),
        contentVersion: artifact.version,
        content: artifact.pdf,
      });
      stagedArtifactIds.push(staged.artifact.id);
      const uploadedArtifact = await uploadStagedArtifact(
        userId,
        artifact,
        staged,
      );
      urls[artifact.target] = uploadedArtifact.url;
      uploaded.push(uploadedArtifact);
    }
  } catch (cause) {
    await scheduleStagedRetirement({
      userId,
      jobId,
      artifactIds: stagedArtifactIds,
    });
    throw cause;
  }
  return { urls, artifacts: uploaded, stagedArtifactIds };
}

function preflightArtifacts(
  input: CommitInput,
):
  | { kind: "ready"; artifacts: VersionedCommitArtifact[] }
  | { kind: "rejected"; result: CommitResult } {
  const requestedArtifacts = input.status === "FINAL" ? input.artifacts : [];
  if (
    input.mergeTarget &&
    requestedArtifacts.some((artifact) => artifact.target !== input.mergeTarget)
  ) {
    return { kind: "rejected", result: { kind: "invalid_ai_content" } };
  }
  const artifacts: VersionedCommitArtifact[] = [];
  for (const artifact of requestedArtifacts) {
    const version = hashApplicationDocumentContent(
      input.aiContent,
      artifact.target,
      input.publicationRenderContext,
    );
    if (!version) {
      return { kind: "rejected", result: { kind: "invalid_ai_content" } };
    }
    artifacts.push({ ...artifact, version });
  }
  const duplicateTarget = findDuplicateArtifactTarget(artifacts);
  if (!duplicateTarget) return { kind: "ready", artifacts };
  return {
    kind: "rejected",
    result: {
      kind: "upload_failed",
      cause: new DuplicateApplicationArtifactTargetError(duplicateTarget),
    },
  };
}

async function prepareArtifactUpload(
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
): Promise<
  | { kind: "ready"; bundle: UploadedArtifactBundle }
  | { kind: "rejected"; result: CommitResult }
> {
  if (
    artifacts.length > 0 &&
    !blobConfigured() &&
    process.env.NODE_ENV !== "test"
  ) {
    return { kind: "rejected", result: { kind: "blob_not_configured" } };
  }
  try {
    const bundle =
      artifacts.length === 0 || !blobConfigured()
        ? { urls: {}, artifacts: [], stagedArtifactIds: [] }
        : await uploadArtifacts(input.userId, input.job.id, artifacts);
    return { kind: "ready", bundle };
  } catch (cause) {
    if (
      process.env.NODE_ENV === "production" &&
      isArtifactBlobPortUnavailable(cause)
    ) {
      return { kind: "rejected", result: { kind: "blob_not_configured" } };
    }
    return { kind: "rejected", result: { kind: "upload_failed", cause } };
  }
}

async function loadCommitApplication(
  tx: Prisma.TransactionClient,
  input: CommitInput,
) {
  // Tailoring acceptance owns the broader locks first:
  // TJOB -> ABAT (when bound) -> TLRN -> JOBA. An unbound writer has already
  // proved there is no active run while holding TJOB.
  await acquireApplicationMutationLock(tx, input.userId, input.job.id);
  const ownedJob = await tx.job.findFirst({
    where: { id: input.job.id, userId: input.userId },
    select: { id: true },
  });
  if (!ownedJob) return { kind: "job_missing" as const };
  const existing = await tx.application.findUnique({
    where: { userId_jobId: { userId: input.userId, jobId: input.job.id } },
    select: APPLICATION_COMMIT_SELECT,
  });
  return { kind: "loaded" as const, existing };
}

function hasExpectedHashConflict(
  input: CommitInput,
  existing: ApplicationCommitRow | null,
): boolean {
  return (
    input.expectedHash !== undefined &&
    (existing?.aiContentHash ?? null) !== input.expectedHash
  );
}

function resolveCommitContent(
  input: CommitInput,
  existing: ApplicationCommitRow | null,
) {
  const previousParsed =
    existing?.aiContent == null
      ? null
      : aiContentSchema.safeParse(existing.aiContent);
  const previousAiContent =
    previousParsed?.success === true ? previousParsed.data : null;
  let aiContent = input.aiContent;
  if (input.mergeTarget) {
    if (existing?.aiContent != null && !previousParsed?.success) {
      return { kind: "invalid_ai_content" as const };
    }
    const evolved = evolveApplicationAiContent({
      current: previousAiContent,
      command: {
        kind: "replace_target_proposal",
        target: input.mergeTarget,
        proposal: input.aiContent,
      },
      reviewContext: input.reviewContext,
    });
    if (evolved.kind !== "evolved") {
      // A modelled outcome, not a crash: evolveApplicationAiContent returns
      // review_context_required when it cannot rebuild the shared review. As a
      // bare Error it rendered as an anonymous 500 that the Runner replays
      // forever, which is precisely the failure shape commitResultResponse was
      // written to eliminate — and it was hiding here, one layer down.
      throw new AppError({
        code: "APPLICATION_REVIEW_CONTEXT_REQUIRED",
        status: 409,
        publicMessage:
          "The job description is unavailable, so the draft cannot be reviewed. Generate this job again.",
        privateDetails: { evolved: evolved.kind },
      });
    }
    aiContent = evolved.aiContent;
  }
  if (input.status === "FINAL" && aiContent.review?.verdict === "blocked") {
    return { kind: "review_blocked" as const, review: aiContent.review };
  }
  return {
    kind: "resolved" as const,
    previousAiContent,
    aiContent,
    aiContentHash: hashAiContent(aiContent),
  };
}

function artifactPersistenceColumns(
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
  uploaded: UploadedArtifactBundle["urls"],
): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (input.status !== "FINAL") return columns;
  for (const artifact of artifacts) {
    const url = uploaded[artifact.target] ?? null;
    if (artifact.target === "resume") {
      columns.resumePdfUrl = url;
      columns.resumePdfName = url ? (artifact.filename ?? null) : null;
    } else {
      columns.coverPdfUrl = url;
    }
  }
  return columns;
}

function mergeAtsValidation(
  existing: ApplicationCommitRow | null,
  artifacts: VersionedCommitArtifact[],
) {
  const previous =
    existing?.atsValidation &&
    typeof existing.atsValidation === "object" &&
    !Array.isArray(existing.atsValidation)
      ? existing.atsValidation
      : {};
  const next = { ...previous };
  for (const artifact of artifacts) {
    if (artifact.atsValidation !== undefined) {
      (next as Record<string, unknown>)[artifact.target] =
        artifact.atsValidation ?? null;
    }
  }
  return next;
}

function supersededArtifacts(
  existing: ApplicationCommitRow | null,
  artifacts: VersionedCommitArtifact[],
  uploaded: UploadedArtifactBundle["urls"],
): { target: ApplicationArtifactTarget; url: string }[] {
  return artifacts
    .map((artifact) => {
      const previous =
        artifact.target === "resume"
          ? existing?.resumePdfUrl
          : existing?.coverPdfUrl;
      const next = uploaded[artifact.target];
      return previous && next && previous !== next
        ? { target: lifecycleTarget(artifact.target), url: previous }
        : null;
    })
    .filter(
      (
        artifact,
      ): artifact is { target: ApplicationArtifactTarget; url: string } =>
        artifact !== null,
    );
}

async function executeCommitTransaction(
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
  uploadBundle: UploadedArtifactBundle,
) {
  return prisma.$transaction(
    (tx) => commitInTransaction(tx, input, artifacts, uploadBundle),
    { timeout: 30_000 },
  );
}

async function commitInTransaction(
  tx: Prisma.TransactionClient,
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
  uploadBundle: UploadedArtifactBundle,
) {
  // acquireUnboundApplicationWriteAuthority went with the TailoringRun table
  // it interleaved with. What actually serialises two writers to the same
  // Application is JOBA, taken inside persistResolvedCommit; the run locks
  // only ever ordered this path against the batch.
  const loaded = await loadCommitApplication(tx, input);
  if (loaded.kind === "job_missing") return loaded;
  if (hasExpectedHashConflict(input, loaded.existing)) {
    return { kind: "stale_write" as const };
  }
  const resolved = resolveCommitContent(input, loaded.existing);
  if (resolved.kind !== "resolved") return resolved;
  const persistenceTargets = artifacts.length
    ? artifacts.map((artifact) => artifact.target)
    : applicationPublicationTargets(
        resolved.aiContent,
        input.publicationRenderContext,
      );
  const renderContextFence = await fenceApplicationRenderContext(
    tx,
    input,
    persistenceTargets,
  );
  if (renderContextFence.kind === "mismatched") {
    return { kind: "stale_render_context" as const };
  }
  return persistResolvedCommit(
    tx,
    input,
    artifacts,
    uploadBundle,
    loaded.existing,
    resolved,
    renderContextFence.current,
  );
}

async function persistResolvedCommit(
  tx: Prisma.TransactionClient,
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
  uploadBundle: UploadedArtifactBundle,
  existing: ApplicationCommitRow | null,
  resolved: Extract<
    ReturnType<typeof resolveCommitContent>,
    { kind: "resolved" }
  >,
  renderContext: ApplicationPublicationRenderContext,
) {
  const publicationTransition = transitionApplicationPublication({
    previousAiContent: resolved.previousAiContent,
    previous: applicationPublicationRecord(existing),
    nextAiContent: resolved.aiContent,
    renderContext,
    publishedTargets: artifacts.map((artifact) => artifact.target),
    nextUrls: uploadBundle.urls,
  });
  const data = applicationPersistenceData(
    input,
    artifacts,
    uploadBundle.urls,
    existing,
    resolved,
    publicationTransition.persistence,
  );
  const application = await tx.application.upsert({
    where: { userId_jobId: { userId: input.userId, jobId: input.job.id } },
    create: { userId: input.userId, jobId: input.job.id, ...data },
    update: data,
    select: { id: true },
  });
  await persistCommitSideEffects(
    tx,
    input,
    artifacts,
    uploadBundle,
    existing,
    application.id,
    resolved,
    publicationTransition.publication,
  );
  return appliedCommitResult(
    application.id,
    resolved,
    publicationTransition.publication,
  );
}

function appliedCommitResult(
  applicationId: string,
  resolved: Extract<
    ReturnType<typeof resolveCommitContent>,
    { kind: "resolved" }
  >,
  publication: ApplicationPublication,
) {
  return {
    kind: "committed" as const,
    applicationId,
    aiContent: resolved.aiContent,
    aiContentHash: resolved.aiContentHash,
    publication,
  };
}

function applicationPersistenceData(
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
  urls: Partial<Record<CommitTarget, string>>,
  existing: ApplicationCommitRow | null,
  resolved: Extract<
    ReturnType<typeof resolveCommitContent>,
    { kind: "resolved" }
  >,
  publication: ReturnType<
    typeof transitionApplicationPublication
  >["persistence"],
) {
  return {
    ...input.extraData,
    resumeProfileId: input.resumeProfileId,
    company: input.job.company,
    role: input.job.title,
    aiContent: resolved.aiContent,
    aiContentHash: resolved.aiContentHash,
    atsValidation: mergeAtsValidation(existing, artifacts),
    reviewReport: resolved.aiContent.review ?? undefined,
    ...publication,
    ...artifactPersistenceColumns(input, artifacts, urls),
  };
}

async function persistCommitSideEffects(
  tx: Prisma.TransactionClient,
  input: CommitInput,
  artifacts: VersionedCommitArtifact[],
  uploadBundle: UploadedArtifactBundle,
  existing: ApplicationCommitRow | null,
  applicationId: string,
  resolved: Extract<
    ReturnType<typeof resolveCommitContent>,
    { kind: "resolved" }
  >,
  publication: ApplicationPublication,
) {
  await markArtifactsReferencedAndRetireSuperseded(
    tx as unknown as Parameters<
      typeof markArtifactsReferencedAndRetireSuperseded
    >[0],
    {
      userId: input.userId,
      jobId: input.job.id,
      applicationId,
      referenced: uploadBundle.artifacts.map((artifact) => ({
        target: artifact.lifecycleTarget,
        pathname: artifact.pathname,
        url: artifact.url,
      })),
      superseded: supersededArtifacts(existing, artifacts, uploadBundle.urls),
    },
  );
  await persistReviewLedger(tx, {
    userId: input.userId,
    applicationId,
    jobId: input.job.id,
    aiContent: resolved.aiContent,
  });
}

async function retireCommitBundle(
  input: CommitInput,
  uploadBundle: UploadedArtifactBundle,
) {
  await scheduleStagedRetirement({
    userId: input.userId,
    jobId: input.job.id,
    artifactIds: uploadBundle.stagedArtifactIds,
  });
}

async function settleCommitResult(
  input: CommitInput,
  uploadBundle: UploadedArtifactBundle,
  result: Awaited<ReturnType<typeof executeCommitTransaction>>,
): Promise<CommitResult> {
  if (result.kind !== "committed") {
    await retireCommitBundle(input, uploadBundle);
    return result;
  }
  // The REPLAYED branch went with the acceptance receipts. A commit that
  // reached this point actually wrote, so its uploads are the live ones.
  return {
    kind: "committed",
    applicationId: result.applicationId,
    aiContent: result.aiContent,
    aiContentHash: result.aiContentHash,
    publication: result.publication,
    urls: uploadBundle.urls,
  };
}

export async function commitApplicationArtifact(
  input: CommitInput,
): Promise<CommitResult> {
  const preflight = preflightArtifacts(input);
  if (preflight.kind === "rejected") return preflight.result;
  const upload = await prepareArtifactUpload(input, preflight.artifacts);
  if (upload.kind === "rejected") return upload.result;

  const artifacts = preflight.artifacts;
  const uploadBundle = upload.bundle;
  let committed = false;

  try {
    const result = await executeCommitTransaction(
      input,
      artifacts,
      uploadBundle,
    );
    const settled = await settleCommitResult(input, uploadBundle, result);
    committed = true;
    return settled;
  } catch (error) {
    if (!committed) {
      await retireCommitBundle(input, uploadBundle);
    }
    throw error;
  }
}
