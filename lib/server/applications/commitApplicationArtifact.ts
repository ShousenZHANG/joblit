import { del, put } from "@vercel/blob";
import { prisma } from "@/lib/server/prisma";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import { mergeAiContentForTarget } from "@/lib/server/applications/mergeAiContentForTarget";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { aiContentSchema, hashAiContent, type AiContent } from "@/lib/shared/schemas/aiContent";
import type { AtsPdfValidation } from "@/lib/server/applications/atsPdfValidator";

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

export type CommitInput = {
  userId: string;
  job: { id: string; title: string; company: string | null };
  resumeProfileId: string;
  /** The AI Content for the target(s) being committed. */
  aiContent: AiContent;
  /** Rendered PDFs to upload. Empty for a DRAFT commit, which renders nothing. */
  artifacts: CommitArtifact[];
  status: "DRAFT" | "FINAL";
  /**
   * Which half of the AI Content this write owns, when it owns only one.
   *
   * A single-target build produces a complete AI Content whose other half is
   * empty stubs; persisting that directly erases the other artifact. Set this
   * and the module merges against the row instead. Omit it only when the
   * incoming content covers both halves.
   */
  mergeTarget?: CommitTarget;
  /**
   * Present means compare-and-swap: the write only lands if the row still
   * holds this hash. `null` matches a row that has no AI Content yet.
   * Absent means last-writer-wins under the advisory lock alone.
   */
  expectedHash?: string | null;
  /** Extra columns to write, e.g. a reviewer report. */
  extraData?: Record<string, unknown>;
};

export type CommitResult =
  | {
      kind: "committed";
      applicationId: string;
      aiContent: AiContent;
      aiContentHash: string;
      urls: Partial<Record<CommitTarget, string>>;
    }
  | { kind: "stale_write" }
  | { kind: "job_missing" }
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
  return urls;
}

export async function commitApplicationArtifact(input: CommitInput): Promise<CommitResult> {
  let uploaded: Partial<Record<CommitTarget, string>>;
  try {
    uploaded = await uploadArtifacts(input.userId, input.job.id, input.artifacts);
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
            resumePdfUrl: true,
            coverPdfUrl: true,
            aiContent: true,
            aiContentHash: true,
            atsValidation: true,
          },
        });

        if (input.expectedHash !== undefined) {
          const currentHash = existing?.aiContentHash ?? null;
          if (currentHash !== input.expectedHash) return { kind: "stale_write" as const };
        }

        let aiContent = input.aiContent;
        if (input.mergeTarget) {
          const parsed = aiContentSchema.safeParse(existing?.aiContent);
          aiContent = mergeAiContentForTarget(
            parsed.success ? parsed.data : null,
            input.aiContent,
            input.mergeTarget,
          );
        }
        const aiContentHash = hashAiContent(aiContent);

        const artifactColumns: Record<string, unknown> = {};
        // A DRAFT commit records content only — the rendered PDF, if any, still
        // belongs to the previous FINAL.
        if (input.status === "FINAL") {
          for (const artifact of input.artifacts) {
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
        for (const artifact of input.artifacts) {
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

        const superseded = input.artifacts
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
        };
      },
      { timeout: 30_000 },
    );

    if (result.kind !== "committed") {
      await deleteBlobs(uploadedUrls);
      return result;
    }

    committed = true;
    await deleteBlobs(result.superseded);
    return {
      kind: "committed",
      applicationId: result.applicationId,
      aiContent: result.aiContent,
      aiContentHash: result.aiContentHash,
      urls: uploaded,
    };
  } catch (error) {
    if (!committed) await deleteBlobs(uploadedUrls);
    throw error;
  }
}
