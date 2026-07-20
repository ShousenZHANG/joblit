import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import {
  aiContentSchema,
  hashAiContent,
} from "@/lib/shared/schemas/aiContent";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z.object({
  aiContent: aiContentSchema,
  /** Hash from the client's last-known load. `null` on first save. */
  expectedHash: z.string().nullable(),
});

/**
 * Auto-save target for the Tailor edit page. Persists aiContent and
 * keeps the Application in DRAFT status. Returns the new aiContentHash
 * for the caller to remember as the next expectedHash.
 *
 * 409 on stale-write (expectedHash mismatch) — caller's UI should
 * surface a Reload / Overwrite dialog.
 */
export async function PATCH(
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
    const { aiContent, expectedHash } = parsedBody.data;

    const existing = await prisma.application.findFirst({
      where: { id: parsedParams.data.id, userId },
      select: { id: true, jobId: true, aiContentHash: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Application not found" }, requestId },
        { status: 404 },
      );
    }

    if (expectedHash !== existing.aiContentHash) {
      return NextResponse.json(
        {
          error: {
            code: "STALE_WRITE",
            message: "Another tab updated this draft",
          },
          currentHash: existing.aiContentHash,
          requestId,
        },
        { status: 409 },
      );
    }

    const newHash = hashAiContent(aiContent);
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
            aiContent,
            aiContentHash: newHash,
          },
        });
      },
      { timeout: 30_000 },
    );
    if (updated.count !== 1) {
      return NextResponse.json(
        {
          error: {
            code: "STALE_WRITE",
            message: "Another tab updated this draft",
          },
          requestId,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      status: "DRAFT",
      aiContentHash: newHash,
      requestId,
    });
  });
}
