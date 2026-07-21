import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import {
  aiContentSchema,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
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
  return withSessionRoute(async ({ userId, requestId }) => {
    const params = await ctx.params;
    const parsedParams = ParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMS", message: "Invalid application id" }, requestId },
        { status: 400 },
      );
    }

    const parsedBody = await parseJsonBody(req, BodySchema, requestId);
    if (!parsedBody.ok) return parsedBody.response;
    const { expectedHash } = parsedBody.data;

    const existing = await prisma.application.findFirst({
      where: { id: parsedParams.data.id, userId },
      select: { id: true, jobId: true, aiContent: true, aiContentHash: true },
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

    const reset = resetToOriginalProposal(parsed.data);
    const newHash = hashAiContent(reset);

    const updated = await prisma.$transaction(
      async (tx) => {
        await acquireApplicationMutationLock(
          tx,
          userId,
          existing.jobId ?? existing.id,
        );
        return tx.application.updateMany({
          where: {
            id: existing.id,
            userId,
            aiContentHash: expectedHash,
          },
          data: {
            status: "DRAFT",
            aiContent: reset,
            aiContentHash: newHash,
          },
        });
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
  });
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

function resetToOriginalProposal(content: AiContent): AiContent {
  return {
    ...content,
    cv: {
      summary: {
        aiText: content.cv.summary.aiText,
        originalText: content.cv.summary.originalText,
        accepted: true,
      },
      latestExperience: {
        experienceIndex: content.cv.latestExperience.experienceIndex,
        addedBullets: content.cv.latestExperience.addedBullets.map((b) => ({
          text: b.text,
          accepted: b.qualityGate?.passed ?? true,
          ...(b.qualityGate ? { qualityGate: b.qualityGate } : {}),
        })),
      },
    },
    cover: {
      paragraphOne: { aiText: content.cover.paragraphOne.aiText, accepted: true },
      paragraphTwo: { aiText: content.cover.paragraphTwo.aiText, accepted: true },
      paragraphThree: { aiText: content.cover.paragraphThree.aiText, accepted: true },
    },
  };
}
