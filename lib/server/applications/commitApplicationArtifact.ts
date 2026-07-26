import { prisma } from "@/lib/server/prisma";
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
import {
  aiContentSchema,
  hashAiContent,
  type AiApplicationReview,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import type { AtsPdfValidation } from "@/lib/server/applications/atsPdfValidator";
import {
  completeTailoringRunAcceptance,
  prepareTailoringRunAcceptance,
} from "@/lib/server/tailoringRuns/tailoringRunAcceptance";
import type { TailoringAcceptanceRequest } from "@/lib/server/tailoringRuns/tailoringRunTypes";
import type { TailoringRunTransaction } from "@/lib/server/tailoringRuns/tailoringRunDatabase";

/**
 * Commit a rendered Application artifact.
 *
 * This owns the sequence that used to be written out three times, with three
 * different answers to "what happens when the upload half-succeeds":
 *
 *   stage -> upload -> transaction(lock -> read -> merge -> write -> ledger)
 *   -> enqueue superseded artifact for reconciliation
 *
 * The only fact a caller carries forward is the returned `aiContentHash`: it is
 * what the next write must send as `expectedHash`.
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

  constructor(readonly target: CommitTarget) {
    super(`Duplicate application artifact target: ${target}`);
    this.name = "DuplicateApplicationArtifactTargetError";
  }
}

export type CommitArtifact = {
  target: CommitTarget;
  pdf: Buffer;
  /** Download filename. Only the resume column stores one. */
  filename?: string | null;
  atsValidation?: AtsPdfValidation | null;
  /**
   * Blob path version segment. Callers that support compare-and-swap pass the
   * content hash so the URL itself identifies which content it rendered from,
   * which is what makes a re-finalize idempotent.
   */
  version: string;
};

type CommitBaseFields = {
  userId: string;
  job: { id: string; title: string; company: string | null };
  resumeProfileId: string;
  /** The AI Content for the target(s) being committed. */
  aiContent: AiContent;
  /**
   * Present means compare-and-swap: the write only lands if the row still
   * holds this hash. `null` matches a row that has no AI Content yet.
   * Absent means last-writer-wins under the advisory lock alone.
   */
  expectedHash?: string | null;
  /** Extra columns to write, e.g. a reviewer report. */
  extraData?: Record<string, unknown>;
  /**
   * Optional generation Acceptance commands. When present, their attempt
   * fences and receipts are committed in the same transaction as Application.
   */
  tailoring?: readonly TailoringAcceptanceRequest[];
};

type CommitBaseInput = CommitBaseFields &
  (
    | {
        status: "DRAFT";
        /** DRAFT is content-only and cannot own an uploaded artifact. */
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
      /** Omit only when the incoming AI Content owns both targets. */
      mergeTarget?: undefined;
      reviewContext?: never;
    });

export type CommitResult =
  | {
      kind: "committed";
      applicationId: string;
      aiContent: AiContent;
      aiContentHash: string;
      urls: Partial<Record<CommitTarget, string>>;
      tailoringDisposition?: "APPLIED" | "REPLAYED";
    }
  | { kind: "stale_write" }
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

function lifecycleTarget(target: CommitTarget): ApplicationArtifactTarget {
  return target === "resume" ? "RESUME_PDF" : "COVER_PDF";
}

function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
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
  artifact: CommitArtifact,
  staged: Awaited<ReturnType<typeof stageApplicationArtifact>>,
): Promise<UploadedArtifact> {
  // An exact retry can reuse the already referenced immutable object without
  // another network call.
  let url =
    staged.artifact.state === "REFERENCED" ? staged.artifact.url : null;
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
  if (!url) throw new Error("APPLICATION_ARTIFACT_UPLOAD_URL_MISSING");
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
  artifacts: CommitArtifact[],
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

export async function commitApplicationArtifact(input: CommitInput): Promise<CommitResult> {
  // DRAFT commits are content-only. Ignore an untyped JavaScript caller that
  // supplies artifacts so it cannot upload an unreachable Blob.
  const artifacts = input.status === "FINAL" ? input.artifacts : [];
  const duplicateTarget = findDuplicateArtifactTarget(artifacts);
  if (duplicateTarget) {
    return {
      kind: "upload_failed",
      cause: new DuplicateApplicationArtifactTargetError(duplicateTarget),
    };
  }
  if (
    artifacts.length > 0 &&
    !blobConfigured() &&
    process.env.NODE_ENV !== "test"
  ) {
    return { kind: "blob_not_configured" };
  }

  let uploadBundle: UploadedArtifactBundle;
  try {
    // Unit tests can exercise the content-only FINAL path without provisioning
    // Blob. Every interactive runtime fails closed above so it cannot clear a
    // previously valid URL with a null pseudo-success.
    uploadBundle =
      artifacts.length === 0 || !blobConfigured()
        ? { urls: {}, artifacts: [], stagedArtifactIds: [] }
        : await uploadArtifacts(input.userId, input.job.id, artifacts);
  } catch (cause) {
    if (
      process.env.NODE_ENV === "production" &&
      isArtifactBlobPortUnavailable(cause)
    ) {
      return { kind: "blob_not_configured" };
    }
    // Deliberately not a partial commit. Writing a null URL here is what let
    // a transient Blob outage clear a user's previous PDF.
    return { kind: "upload_failed", cause };
  }

  const uploaded = uploadBundle.urls;
  let committed = false;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const preparedTailoring =
          input.tailoring && input.tailoring.length > 0
            ? await prepareTailoringRunAcceptance(
                tx as unknown as TailoringRunTransaction,
                {
                  userId: input.userId,
                  jobId: input.job.id,
                  resumeProfileId: input.resumeProfileId,
                  requests: input.tailoring,
                },
              )
            : null;

        // Tailoring acceptance owns the broader locks first:
        // ABAT (when bound) -> TLRN -> JOBA.
        await acquireApplicationMutationLock(tx, input.userId, input.job.id);

        // Under the lock, so a delete racing the render is reported as a
        // missing Job rather than surfacing as a foreign-key violation.
        const ownedJob = await tx.job.findFirst({
          where: { id: input.job.id, userId: input.userId },
          select: { id: true },
        });
        if (!ownedJob) return { kind: "job_missing" as const };

        const existing = await tx.application.findUnique({
          where: { userId_jobId: { userId: input.userId, jobId: input.job.id } },
          select: {
            id: true,
            resumePdfUrl: true,
            coverPdfUrl: true,
            aiContent: true,
            aiContentHash: true,
            atsValidation: true,
          },
        });

        // A durable target receipt is authoritative after a lost response.
        // Return the current Application projection without reapplying the
        // command; the uploaded retry blobs are cleaned up by the caller.
        if (preparedTailoring && preparedTailoring.pending.length === 0) {
          if (!existing?.aiContent || !existing.aiContentHash) {
            return { kind: "invalid_ai_content" as const };
          }
          const parsed = aiContentSchema.safeParse(existing.aiContent);
          if (!parsed.success) {
            return { kind: "invalid_ai_content" as const };
          }
          return {
            kind: "committed" as const,
            applicationId:
              preparedTailoring.replayed[0]?.applicationId ?? existing.id,
            aiContent: parsed.data,
            aiContentHash: existing.aiContentHash,
            superseded: [] as string[],
            urls: {
              ...(existing.resumePdfUrl
                ? { resume: existing.resumePdfUrl }
                : {}),
              ...(existing.coverPdfUrl ? { cover: existing.coverPdfUrl } : {}),
            } satisfies Partial<Record<CommitTarget, string>>,
            tailoringDisposition: "REPLAYED" as const,
          };
        }

        if (input.expectedHash !== undefined) {
          const currentHash = existing?.aiContentHash ?? null;
          if (currentHash !== input.expectedHash) return { kind: "stale_write" as const };
        }

        let aiContent = input.aiContent;
        if (input.mergeTarget) {
          let current: AiContent | null = null;
          if (existing?.aiContent != null) {
            const parsed = aiContentSchema.safeParse(existing.aiContent);
            if (!parsed.success) {
              return { kind: "invalid_ai_content" as const };
            }
            current = parsed.data;
          }
          const evolved = evolveApplicationAiContent({
            current,
            command: {
              kind: "replace_target_proposal",
              target: input.mergeTarget,
              proposal: input.aiContent,
            },
            reviewContext: input.reviewContext,
          });
          // reviewContext is required by CommitInput for a target replacement;
          // this is an implementation invariant, not a recoverable caller
          // outcome.
          if (evolved.kind !== "evolved") {
            throw new Error("APPLICATION_AI_CONTENT_REVIEW_CONTEXT_REQUIRED");
          }
          aiContent = evolved.aiContent;
        }
        const aiContentHash = hashAiContent(aiContent);
        if (input.status === "FINAL" && aiContent.review?.verdict === "blocked") {
          return {
            kind: "review_blocked" as const,
            review: aiContent.review,
          };
        }

        const artifactColumns: Record<string, unknown> = {};
        // A DRAFT commit records content only — the rendered PDF, if any, still
        // belongs to the previous FINAL.
        if (input.status === "FINAL") {
          for (const artifact of artifacts) {
            const url = uploaded[artifact.target] ?? null;
            if (artifact.target === "resume") {
              artifactColumns.resumePdfUrl = url;
              artifactColumns.resumePdfName = url ? (artifact.filename ?? null) : null;
            } else {
              artifactColumns.coverPdfUrl = url;
            }
          }
        }

        const existingAts =
          existing?.atsValidation &&
          typeof existing.atsValidation === "object" &&
          !Array.isArray(existing.atsValidation)
            ? existing.atsValidation
            : {};
        const atsValidation = { ...existingAts };
        for (const artifact of artifacts) {
          if (artifact.atsValidation !== undefined) {
            (atsValidation as Record<string, unknown>)[artifact.target] =
              artifact.atsValidation ?? null;
          }
        }

        const data = {
          resumeProfileId: input.resumeProfileId,
          company: input.job.company,
          role: input.job.title,
          status: input.status,
          aiContent,
          aiContentHash,
          atsValidation,
          reviewReport: aiContent.review ?? undefined,
          ...input.extraData,
          ...artifactColumns,
        };

        const application = await tx.application.upsert({
          where: { userId_jobId: { userId: input.userId, jobId: input.job.id } },
          create: { userId: input.userId, jobId: input.job.id, ...data },
          update: data,
          select: { id: true },
        });

        const superseded = artifacts
          .map((artifact) => {
            const previous =
              artifact.target === "resume"
                ? existing?.resumePdfUrl
                : existing?.coverPdfUrl;
            const next = uploaded[artifact.target];
            return previous && next && previous !== next
              ? {
                  target: lifecycleTarget(artifact.target),
                  url: previous,
                }
              : null;
          })
          .filter(
            (
              artifact,
            ): artifact is {
              target: ApplicationArtifactTarget;
              url: string;
            } => artifact !== null,
          );

        await markArtifactsReferencedAndRetireSuperseded(
          tx as unknown as Parameters<
            typeof markArtifactsReferencedAndRetireSuperseded
          >[0],
          {
            userId: input.userId,
            jobId: input.job.id,
            applicationId: application.id,
            referenced: uploadBundle.artifacts.map((artifact) => ({
              target: artifact.lifecycleTarget,
              pathname: artifact.pathname,
              url: artifact.url,
            })),
            superseded,
          },
        );

        await persistReviewLedger(tx, {
          userId: input.userId,
          applicationId: application.id,
          jobId: input.job.id,
          aiContent,
        });

        if (preparedTailoring) {
          await completeTailoringRunAcceptance(
            tx as unknown as TailoringRunTransaction,
            {
            prepared: preparedTailoring,
            applicationId: application.id,
            aiContentHash,
            },
          );
        }

        return {
          kind: "committed" as const,
          applicationId: application.id,
          aiContent,
          aiContentHash,
          ...(preparedTailoring
            ? { tailoringDisposition: "APPLIED" as const }
            : {}),
        };
      },
      { timeout: 30_000 },
    );

    if (result.kind !== "committed") {
      await scheduleStagedRetirement({
        userId: input.userId,
        jobId: input.job.id,
        artifactIds: uploadBundle.stagedArtifactIds,
      });
      return result;
    }

    if (result.tailoringDisposition === "REPLAYED") {
      await scheduleStagedRetirement({
        userId: input.userId,
        jobId: input.job.id,
        artifactIds: uploadBundle.stagedArtifactIds,
      });
      committed = true;
      return {
        kind: "committed",
        applicationId: result.applicationId,
        aiContent: result.aiContent,
        aiContentHash: result.aiContentHash,
        urls: result.urls,
        tailoringDisposition: "REPLAYED",
      };
    }

    committed = true;
    return {
      kind: "committed",
      applicationId: result.applicationId,
      aiContent: result.aiContent,
      aiContentHash: result.aiContentHash,
      urls: uploaded,
      ...(result.tailoringDisposition
        ? { tailoringDisposition: result.tailoringDisposition }
        : {}),
    };
  } catch (error) {
    if (!committed) {
      await scheduleStagedRetirement({
        userId: input.userId,
        jobId: input.job.id,
        artifactIds: uploadBundle.stagedArtifactIds,
      });
    }
    throw error;
  }
}
