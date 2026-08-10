import { prisma } from "@/lib/server/prisma";
import { acquireApplicationMutationLock } from "./applicationMutationLock";
import {
  applicationPublicationRecord,
  projectApplicationPublication,
  type ApplicationPublicationRenderContext,
} from "./applicationPublication";
import { fenceApplicationRenderContext } from "./applicationRenderContextFence";
import type {
  ApplicationDocumentTarget,
  ApplicationPublication,
} from "@/lib/shared/applicationPublication";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";
import {
  completeTailoringRunPublication,
  prepareTailoringRunPublication,
} from "@/lib/server/tailoringRuns/tailoringRunPublication";
import type { TailoringRunTransaction } from "@/lib/server/tailoringRuns/tailoringRunDatabase";

type ConfirmApplicationPublicationReplayInput = {
  userId: string;
  applicationId: string;
  jobId: string;
  resumeProfileId: string;
  expectedHash: string | null;
  target: ApplicationDocumentTarget;
  renderContext: ApplicationPublicationRenderContext;
  tailoringPublication?: {
    handle: { id: string; attemptId: string };
    applicationId: string;
    target: "RESUME" | "COVER";
    batchExecutionAttemptId: string;
  };
};

export type ApplicationPublicationReplayResult =
  | {
      kind: "replayed";
      aiContentHash: string;
      publication: ApplicationPublication;
      resumePdfUrl: string | null;
      resumePdfName: string | null;
      coverPdfUrl: string | null;
    }
  | { kind: "render_required" }
  | { kind: "stale_write"; currentHash: string | null }
  | { kind: "stale_render_context" }
  | { kind: "not_found" }
  | { kind: "invalid_ai_content" };

/**
 * Reconfirm an apparently Final document under the same locks used by writes.
 * A replay is returned only while the Application CAS and target-scoped
 * Profile/Job inputs are still current.
 */
export async function confirmApplicationPublicationReplay(
  input: ConfirmApplicationPublicationReplayInput,
): Promise<ApplicationPublicationReplayResult> {
  return prisma.$transaction(
    async (tx) => {
      // Agent replay is a write: acquire its ownership locks before JOBA so
      // this path preserves the global TJOB -> ABAT -> TLRN -> JOBA order used
      // by the normal publication commit. Taking JOBA first can deadlock a
      // concurrent writer that already owns TJOB.
      const publicationTx = tx as unknown as TailoringRunTransaction;
      const preparedPublication = input.tailoringPublication
        ? await prepareTailoringRunPublication(publicationTx, {
            userId: input.userId,
            jobId: input.jobId,
            applicationId: input.applicationId,
            request: input.tailoringPublication,
          })
        : null;
      await acquireApplicationMutationLock(tx, input.userId, input.jobId);
      const current = await tx.application.findFirst({
        where: { id: input.applicationId, userId: input.userId },
        select: {
          status: true,
          jobId: true,
          resumeProfileId: true,
          aiContent: true,
          aiContentHash: true,
          resumePdfUrl: true,
          resumePdfName: true,
          coverPdfUrl: true,
          resumeContentHash: true,
          coverContentHash: true,
          resumePublishedHash: true,
          coverPublishedHash: true,
        },
      });
      if (!current) return { kind: "not_found" };
      if (
        current.jobId !== input.jobId ||
        current.resumeProfileId !== input.resumeProfileId
      ) {
        return { kind: "stale_render_context" };
      }
      if (current.aiContentHash !== input.expectedHash) {
        return {
          kind: "stale_write",
          currentHash: current.aiContentHash,
        };
      }
      // A successful Finalize response is also the client's next CAS
      // baseline. Legacy rows without one must pass through the normal render
      // commit so that the server can establish a non-null hash atomically.
      if (!current.aiContentHash) return { kind: "render_required" };
      const parsed = aiContentSchema.safeParse(current.aiContent);
      if (!parsed.success) return { kind: "invalid_ai_content" };
      const renderContextFence = await fenceApplicationRenderContext(
        tx,
        {
          userId: input.userId,
          job: { id: input.jobId },
          resumeProfileId: input.resumeProfileId,
          publicationRenderContext: input.renderContext,
        },
        [input.target],
      );
      if (renderContextFence.kind === "mismatched") {
        return { kind: "stale_render_context" };
      }
      const publication = projectApplicationPublication({
        aiContent: parsed.data,
        record: applicationPublicationRecord(current),
        renderContext: renderContextFence.current,
      });
      if (publication[input.target].status !== "FINAL") {
        return { kind: "render_required" };
      }
      const publishedDocument = publication[input.target];
      if (!publishedDocument.contentHash) {
        return { kind: "render_required" };
      }
      if (preparedPublication) {
        await completeTailoringRunPublication(publicationTx, {
          prepared: preparedPublication,
          applicationId: input.applicationId,
          documentContentHash: publishedDocument.contentHash,
        });
      }
      return {
        kind: "replayed",
        aiContentHash: current.aiContentHash,
        publication,
        resumePdfUrl: current.resumePdfUrl,
        resumePdfName: current.resumePdfName,
        coverPdfUrl: current.coverPdfUrl,
      };
    },
    { timeout: 30_000 },
  );
}
