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
  return withSessionRoute(
    async ({ userId, requestId, params }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;
      const { aiContent, expectedHash } = parsedBody.data;

      const existing = await prisma.application.findFirst({
        where: { id: params.id, userId },
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

      const committed = await prisma.$transaction(
        async (tx) => {
          await acquireApplicationMutationLock(
            tx,
            userId,
            existing.jobId ?? existing.id,
          );
          const current = await tx.application.findFirst({
            where: { id: existing.id, userId },
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
          if (!current) return { kind: "not_found" as const };
          if (current.aiContentHash !== expectedHash) {
            return {
              kind: "stale" as const,
              currentHash: current.aiContentHash,
            };
          }

          const canonical = aiContentSchema.safeParse(current.aiContent);
          if (!canonical.success) return { kind: "invalid" as const };

          const profile =
            current.resumeProfile?.userId === userId
              ? current.resumeProfile
              : null;
          const jobOwned = current.job?.userId === userId;
          const evolved = evolveApplicationAiContent({
            current: canonical.data,
            command: { kind: "apply_client_edits", submitted: aiContent },
            ...(profile
              ? {
                  reviewContext: {
                    scopeKey: userId,
                    resumeSnapshot: {
                      profile,
                      renderInput: mapResumeProfile(profile),
                    },
                    jobDescription: jobOwned
                      ? current.job?.description
                      : undefined,
                    jobSourceAvailable: jobOwned,
                  },
                }
              : {}),
          });
          if (evolved.kind !== "evolved") {
            return { kind: "evidence_unavailable" as const };
          }
          const reviewedContent = evolved.aiContent;
          const newHash = hashAiContent(reviewedContent);
          const result = await tx.application.updateMany({
            where: {
              id: existing.id,
              userId,
              aiContentHash: expectedHash,
            },
            data: {
              status: "DRAFT",
              aiContent: reviewedContent,
              aiContentHash: newHash,
              reviewReport: reviewedContent.review ?? undefined,
            },
          });
          if (result.count !== 1) return { kind: "stale" as const };
          await persistReviewLedger(tx, {
            userId,
            applicationId: existing.id,
            jobId: current.jobId,
            aiContent: reviewedContent,
          });
          return {
            kind: "committed" as const,
            aiContent: reviewedContent,
            aiContentHash: newHash,
          };
        },
        { timeout: 30_000 },
      );
      if (committed.kind === "not_found") {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Application not found" }, requestId },
          { status: 404 },
        );
      }
      if (committed.kind === "invalid") {
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
      if (committed.kind === "evidence_unavailable") {
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
      if (committed.kind === "stale") {
        return NextResponse.json(
          {
            error: {
              code: "STALE_WRITE",
              message: "Another tab updated this draft",
            },
            ...("currentHash" in committed
              ? { currentHash: committed.currentHash }
              : {}),
            requestId,
          },
          { status: 409 },
        );
      }

      return NextResponse.json({
        status: "DRAFT",
        aiContent: committed.aiContent,
        aiContentHash: committed.aiContentHash,
        requestId,
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
