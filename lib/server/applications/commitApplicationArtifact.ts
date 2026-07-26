import { del, put } from "@vercel/blob";
import { prisma } from "@/lib/server/prisma";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import {
  evolveApplicationAiContent,
  type ApplicationAiContentReviewContext,
} from "@/lib/server/applications/applicationAiContentAggregate";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
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
 *   upload → transaction(lock → read → merge → write → ledger) → GC stale blob
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
 *   good one — `manual-generate` used to do exactly that, clearing the user's
 *   previous PDF whenever Blob was briefly unavailable.
 * - The newly uploaded blob is deleted if the commit does not land, for any
 *   reason including a lost compare-and-swap.
 * - The superseded blob is deleted only after the commit lands.
 */

export type CommitTarget = "resume" | "cover";

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
  | { kind: "upload_failed"; cause: unknown };

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

async function deleteBlobs(urls: Array<string | null | undefined>): Promise<void> {
  const token = blobToken();
  if (!token) return;
  const unique = Array.from(
    new Set(urls.filter((url): url is string => typeof url === "string" && url.trim() !== "")),
  );
  if (unique.length === 0) return;
  await Promise.allSettled(unique.map((url) => del(url, { token })));
}

async function uploadArtifacts(
  userId: string,
  jobId: string,
  artifacts: CommitArtifact[],
): Promise<Partial<Record<CommitTarget, string>>> {
  const token = blobToken();
  // No Blob configured is a deployment state, not a per-request failure: the
  // commit proceeds and the row simply carries no URL for this target.
  if (!token) return {};

  const urls: Partial<Record<CommitTarget, string>> = {};
  try {
    for (const artifact of artifacts) {
      const blob = await put(
        buildApplicationArtifactBlobPath({
          userId,
          jobId,
          target: artifact.target,
          version: artifact.version,
        }),
        artifact.pdf,
        {
          access: "public",
          contentType: "application/pdf",
          token,
          ...APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
        },
      );
      urls[artifact.target] = blob.url;
    }
  } catch (cause) {
    await deleteBlobs(Object.values(urls));
    throw cause;
  }
  return urls;
}

export async function commitApplicationArtifact(input: CommitInput): Promise<CommitResult> {
  // DRAFT commits are content-only. Ignore an untyped JavaScript caller that
  // supplies artifacts so it cannot upload an unreachable Blob.
  const artifacts = input.status === "FINAL" ? input.artifacts : [];
  let uploaded: Partial<Record<CommitTarget, string>>;
  try {
    uploaded = await uploadArtifacts(input.userId, input.job.id, artifacts);
  } catch (cause) {
    // Deliberately not a partial commit. Writing a null URL here is what let
    // a transient Blob outage clear a user's previous PDF.
    return { kind: "upload_failed", cause };
  }

  const uploadedUrls = Object.values(uploaded);
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

        const superseded = artifacts
          .map((artifact) => {
            const previous =
              artifact.target === "resume" ? existing?.resumePdfUrl : existing?.coverPdfUrl;
            const next = uploaded[artifact.target];
            return previous && next && previous !== next ? previous : null;
          })
          .filter((url): url is string => url !== null);

        return {
          kind: "committed" as const,
          applicationId: application.id,
          aiContent,
          aiContentHash,
          superseded,
          ...(preparedTailoring
            ? { tailoringDisposition: "APPLIED" as const }
            : {}),
        };
      },
      { timeout: 30_000 },
    );

    if (result.kind !== "committed") {
      await deleteBlobs(uploadedUrls);
      return result;
    }

    if (result.tailoringDisposition === "REPLAYED") {
      await deleteBlobs(uploadedUrls);
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
    await deleteBlobs(result.superseded);
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
    if (!committed) await deleteBlobs(uploadedUrls);
    throw error;
  }
}
