import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { aiContentSchema, hashAiContent } from "@/lib/shared/schemas/aiContent";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { acquireUnboundApplicationWriteAuthority } from "@/lib/server/tailoringRuns/tailoringJobOwnership";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import { evolveApplicationAiContent } from "@/lib/server/applications/applicationAiContentAggregate";
import {
  buildApplicationPublicationRenderContext,
  transitionApplicationPublication,
  UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT,
} from "@/lib/server/applications/applicationPublication";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  applicationPublicationTargets,
  applicationRenderContextMatchesCurrentSources,
} from "@/lib/server/applications/applicationRenderContextFence";

export const runtime = "nodejs";

const BodySchema = z.object({ expectedHash: z.string().nullable() });

/**
 * Reset all user edits on the stored aiContent back to the original
 * AI proposal:
 *   - Clear userEdit on every editable field (summary, bullets,
 *     cover paragraphs).
 *   - Reset summary.accepted = true.
 *   - Reset bullet.accepted to qualityGate.passed (or true if no
 *     gate verdict was recorded).
 *   - Reset cover paragraphs accepted = true.
 *
 * Only documents whose render-relevant content changes become DRAFT. The
 * caller's UI then re-renders from the reset snapshot.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, requestId, params }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;
      const { expectedHash } = parsedBody.data;

      const existing = await prisma.application.findFirst({
        where: { id: params.id, userId },
        select: {
          id: true,
          jobId: true,
          resumeProfileId: true,
          aiContent: true,
          aiContentHash: true,
          status: true,
          resumePdfUrl: true,
          coverPdfUrl: true,
          resumeContentHash: true,
          coverContentHash: true,
          resumePublishedHash: true,
          coverPublishedHash: true,
          resumeProfile: {
            select: {
              id: true,
              userId: true,
              name: true,
              locale: true,
              summary: true,
              basics: true,
              links: true,
              skills: true,
              experiences: true,
              projects: true,
              education: true,
            },
          },
          job: {
            select: {
              userId: true,
              title: true,
              company: true,
              description: true,
              market: true,
            },
          },
        },
      });
      if (!existing) {
        return NextResponse.json(
          {
            error: { code: "NOT_FOUND", message: "Application not found" },
            requestId,
          },
          { status: 404 },
        );
      }

      if (expectedHash !== existing.aiContentHash) {
        return staleDiscardResponse(requestId, existing.aiContentHash);
      }

      if (!existing.aiContent) {
        return NextResponse.json(
          {
            error: {
              code: "NO_AI_CONTENT",
              message: "No AI content to discard",
            },
            requestId,
          },
          { status: 400 },
        );
      }

      const parsed = aiContentSchema.safeParse(existing.aiContent);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: {
              code: "AI_CONTENT_INVALID",
              message: "Stored aiContent failed schema validation",
            },
            requestId,
          },
          { status: 500 },
        );
      }

      const profile =
        existing.resumeProfile?.userId === userId
          ? existing.resumeProfile
          : null;
      const jobOwned = existing.job?.userId === userId;
      const evolved = evolveApplicationAiContent({
        current: parsed.data,
        command: { kind: "discard_edits" },
        ...(profile
          ? {
              reviewContext: {
                scopeKey: userId,
                resumeSnapshot: {
                  profile,
                  renderInput: mapResumeProfile(profile),
                },
                jobDescription: jobOwned
                  ? existing.job?.description
                  : undefined,
                jobSourceAvailable: jobOwned,
              },
            }
          : {}),
      });
      if (evolved.kind !== "evolved") {
        return NextResponse.json(
          {
            error: {
              code: "CANONICAL_EVIDENCE_UNAVAILABLE",
              message:
                "The server source snapshot is unavailable. Re-generate this draft.",
            },
            requestId,
          },
          { status: 409 },
        );
      }
      const reset = evolved.aiContent;
      const newHash = hashAiContent(reset);
      const publicationRenderContext =
        profile && jobOwned && existing.job
          ? buildApplicationPublicationRenderContext({
              profile,
              job: {
                title: existing.job.title,
                company: existing.job.company,
                market: existing.job.market,
              },
            })
          : UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT;

      const updated = await prisma
        .$transaction(
          async (tx) => {
            const mutationJobId = existing.jobId ?? existing.id;
            await acquireUnboundApplicationWriteAuthority(tx, {
              userId,
              jobId: mutationJobId,
            });
            await acquireApplicationMutationLock(tx, userId, mutationJobId);
            const current = await tx.application.findFirst({
              where: { id: existing.id, userId },
              select: {
                jobId: true,
                resumeProfileId: true,
                aiContentHash: true,
                status: true,
                resumePdfUrl: true,
                coverPdfUrl: true,
                resumeContentHash: true,
                coverContentHash: true,
                resumePublishedHash: true,
                coverPublishedHash: true,
              },
            });
            if (!current || current.aiContentHash !== expectedHash) {
              return {
                kind: "stale" as const,
                ...(current ? { currentHash: current.aiContentHash } : {}),
              };
            }
            if (
              current.jobId !== existing.jobId ||
              current.resumeProfileId !== existing.resumeProfileId
            ) {
              return { kind: "stale_render_context" as const };
            }
            if (
              publicationRenderContext.available &&
              (!existing.jobId ||
                !(await applicationRenderContextMatchesCurrentSources(
                  tx,
                  {
                    userId,
                    job: { id: existing.jobId },
                    resumeProfileId: profile!.id,
                    publicationRenderContext,
                  },
                  applicationPublicationTargets(
                    reset,
                    publicationRenderContext,
                  ),
                )))
            ) {
              return { kind: "stale_render_context" as const };
            }
            const publicationTransition = transitionApplicationPublication({
              previousAiContent: parsed.data,
              previous: {
                status: current.status,
                aiContentHash: current.aiContentHash,
                resumePdfUrl: current.resumePdfUrl,
                coverPdfUrl: current.coverPdfUrl,
                resumeContentHash: current.resumeContentHash,
                coverContentHash: current.coverContentHash,
                resumePublishedHash: current.resumePublishedHash,
                coverPublishedHash: current.coverPublishedHash,
              },
              nextAiContent: reset,
              renderContext: publicationRenderContext,
              publishedTargets: [],
            });
            const result = await tx.application.updateMany({
              where: {
                id: existing.id,
                userId,
                jobId: existing.jobId,
                resumeProfileId: existing.resumeProfileId,
                aiContentHash: expectedHash,
              },
              data: {
                ...publicationTransition.persistence,
                aiContent: reset,
                aiContentHash: newHash,
                reviewReport: reset.review ?? undefined,
              },
            });
            if (result.count === 1) {
              await persistReviewLedger(tx, {
                userId,
                applicationId: existing.id,
                jobId: existing.jobId,
                aiContent: reset,
              });
            }
            return result.count === 1
              ? {
                  kind: "committed" as const,
                  publication: publicationTransition.publication,
                }
              : { kind: "stale" as const };
          },
          { timeout: 30_000 },
        )
        .catch((error: unknown) => {
          if (error instanceof TailoringRunError) {
            return { kind: "tailoring_run_error" as const, error };
          }
          throw error;
        });
      if (updated.kind === "tailoring_run_error") {
        return errorJson(
          updated.error.code,
          updated.error.message,
          updated.error.status,
          { requestId },
        );
      }
      if (updated.kind === "stale") {
        return staleDiscardResponse(
          requestId,
          "currentHash" in updated ? updated.currentHash : undefined,
        );
      }
      if (updated.kind === "stale_render_context") {
        return NextResponse.json(
          {
            error: {
              code: "STALE_RENDER_CONTEXT",
              message:
                "Your resume profile or job changed while edits were being discarded. Try again.",
            },
            requestId,
          },
          { status: 409 },
        );
      }

      return NextResponse.json({
        status: updated.publication.status,
        publication: updated.publication,
        aiContent: reset,
        aiContentHash: newHash,
        requestId,
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

function staleDiscardResponse(requestId: string, currentHash?: string | null) {
  return NextResponse.json(
    {
      error: {
        code: "STALE_WRITE",
        message: "Another tab updated this draft",
      },
      ...(currentHash !== undefined ? { currentHash } : {}),
      requestId,
    },
    { status: 409 },
  );
}
