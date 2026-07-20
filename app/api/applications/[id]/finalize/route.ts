import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { enforceApplicationRenderRateLimit } from "@/lib/server/api/applicationRenderRateLimit";
import {
  deleteApplicationArtifact,
  renderFinalApplication,
  renderFinalCoverLetter,
} from "@/lib/server/applications/finalizeApplication";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

const BodySchema = z.object({
  /**
   * Hash from the client's last-known load. Stale-write guard against
   * concurrent autosaves from a second tab.
   */
  expectedHash: z.string().nullable(),
});

function parseTarget(req: Request): "resume" | "cover" {
  const url = new URL(req.url);
  return url.searchParams.get("target") === "cover" ? "cover" : "resume";
}

function staleFinalizeResponse(requestId: string) {
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

function isCurrentVersionedArtifact(
  url: string | null,
  target: "resume" | "cover",
  expectedHash: string | null,
): boolean {
  if (!url || !expectedHash) return false;
  try {
    return decodeURIComponent(new URL(url).pathname).includes(
      `/${target}.${expectedHash}-`,
    );
  } catch {
    return false;
  }
}

/**
 * Render the current aiContent into a PDF and flip the Application
 * to FINAL. The Tailor edit page calls this from the Finalize button.
 *
 * 400 if the row carries no aiContent (legacy migrated row that needs
 * re-generation rather than direct finalize).
 *
 * 409 on hash mismatch: another tab finalized in parallel; the client
 * should reload to see the latest snapshot.
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
      select: {
        id: true,
        userId: true,
        status: true,
        aiContent: true,
        aiContentHash: true,
        resumePdfUrl: true,
        resumePdfName: true,
        coverPdfUrl: true,
        jobId: true,
        company: true,
        role: true,
        job: {
          select: { id: true, title: true, company: true, market: true },
        },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Application not found" }, requestId },
        { status: 404 },
      );
    }

    if (!existing.aiContent) {
      return NextResponse.json(
        {
          error: {
            code: "NO_AI_CONTENT",
            message:
              "Application has no AI content stored. Re-generate before finalizing.",
          },
          requestId,
        },
        { status: 400 },
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

    const aiContentParsed = aiContentSchema.safeParse(existing.aiContent);
    if (!aiContentParsed.success) {
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

    const job = existing.job ?? {
      id: null,
      title: existing.role ?? "Untitled",
      company: existing.company ?? null,
      market: "AU",
    };

    const target = parseTarget(req);
    // Repeat clicks for an already-committed artifact are a read, not another
    // LaTeX compile + Blob upload. The versioned path ties the target URL to
    // this exact aiContent hash; global Application status alone is not enough
    // because CV and cover letter finalize independently.
    if (
      existing.status === "FINAL" &&
      (target === "resume"
        ? isCurrentVersionedArtifact(
            existing.resumePdfUrl,
            "resume",
            expectedHash,
          )
        : isCurrentVersionedArtifact(
            existing.coverPdfUrl,
            "cover",
            expectedHash,
          ))
    ) {
      return NextResponse.json({
        status: "FINAL",
        ...(target === "resume"
          ? {
              resumePdfUrl: existing.resumePdfUrl,
              resumePdfName: existing.resumePdfName,
            }
          : { coverPdfUrl: existing.coverPdfUrl }),
        requestId,
      });
    }

    const limited = enforceApplicationRenderRateLimit(userId, requestId);
    if (limited) return limited;

    // A unique path makes an uncommitted render safe to delete if the CAS
    // below loses to an autosave or another finalizer.
    const artifactVersion = `${existing.aiContentHash ?? "legacy"}-${randomUUID()}`;
    const renderJob = {
      id: job.id ?? null,
      title: job.title ?? "Untitled",
      company: job.company,
      market: job.market ?? "AU",
    };

    if (target === "cover") {
      const { coverPdfUrl, coverPdfName } = await renderFinalCoverLetter({
        applicationId: existing.id,
        userId,
        aiContent: aiContentParsed.data,
        artifactVersion,
        job: renderJob,
      });
      let committed: { count: number };
      try {
        committed = await prisma.$transaction(
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
                coverPdfUrl: existing.coverPdfUrl,
              },
              data: { status: "FINAL", coverPdfUrl },
            });
          },
          { timeout: 30_000 },
        );
      } catch (error) {
        if (coverPdfUrl !== existing.coverPdfUrl) {
          await deleteApplicationArtifact(coverPdfUrl).catch(() => undefined);
        }
        throw error;
      }
      if (committed.count !== 1) {
        if (coverPdfUrl !== existing.coverPdfUrl) {
          await deleteApplicationArtifact(coverPdfUrl).catch(() => undefined);
        }
        return staleFinalizeResponse(requestId);
      }
      if (existing.coverPdfUrl && existing.coverPdfUrl !== coverPdfUrl) {
        await deleteApplicationArtifact(existing.coverPdfUrl).catch(() => undefined);
      }
      return NextResponse.json({
        status: "FINAL",
        coverPdfUrl,
        coverPdfName,
        requestId,
      });
    }

    const { resumePdfUrl, resumePdfName } = await renderFinalApplication({
      applicationId: existing.id,
      userId,
      aiContent: aiContentParsed.data,
      artifactVersion,
      job: renderJob,
    });

    let committed: { count: number };
    try {
      committed = await prisma.$transaction(
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
              resumePdfUrl: existing.resumePdfUrl,
            },
            data: { status: "FINAL", resumePdfUrl, resumePdfName },
          });
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (resumePdfUrl !== existing.resumePdfUrl) {
        await deleteApplicationArtifact(resumePdfUrl).catch(() => undefined);
      }
      throw error;
    }
    if (committed.count !== 1) {
      if (resumePdfUrl !== existing.resumePdfUrl) {
        await deleteApplicationArtifact(resumePdfUrl).catch(() => undefined);
      }
      return staleFinalizeResponse(requestId);
    }
    if (existing.resumePdfUrl && existing.resumePdfUrl !== resumePdfUrl) {
      await deleteApplicationArtifact(existing.resumePdfUrl).catch(() => undefined);
    }

    return NextResponse.json({
      status: "FINAL",
      resumePdfUrl,
      resumePdfName,
      requestId,
    });
  });
}
