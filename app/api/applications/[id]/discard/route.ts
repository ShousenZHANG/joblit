import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import {
  aiContentSchema,
  hashAiContent,
} from "@/lib/shared/schemas/aiContent";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import { evolveApplicationAiContent } from "@/lib/server/applications/applicationAiContentAggregate";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";

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
 * Status stays DRAFT. The caller's UI then re-renders from the reset
 * snapshot.
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
          aiContent: true,
          aiContentHash: true,
          resumeProfile: {
            select: {
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
            select: { userId: true, description: true },
          },
        },
      });
      if (!existing) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Application not found" }, requestId },
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

      const updated = await prisma.$transaction(
        async (tx) => {
          await acquireApplicationMutationLock(
            tx,
            userId,
            existing.jobId ?? existing.id,
          );
          const result = await tx.application.updateMany({
            where: {
              id: existing.id,
              userId,
              aiContentHash: expectedHash,
            },
            data: {
              status: "DRAFT",
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
          return result;
        },
        { timeout: 30_000 },
      );
      if (updated.count !== 1) {
        return staleDiscardResponse(requestId);
      }

      return NextResponse.json({
        status: "DRAFT",
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
