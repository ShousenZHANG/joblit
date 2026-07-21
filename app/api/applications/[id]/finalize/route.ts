import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { enforceApplicationRenderRateLimit } from "@/lib/server/api/applicationRenderRateLimit";
import {
  deleteApplicationArtifact,
  renderFinalApplication,
  renderFinalCoverLetter,
} from "@/lib/server/applications/finalizeApplication";
import {
  aiContentSchema,
  hashAiContent,
} from "@/lib/shared/schemas/aiContent";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import { rebuildCanonicalAiContent } from "@/lib/server/applications/canonicalAiContent";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  AtsPdfValidationError,
  type AtsPdfValidation,
} from "@/lib/server/applications/atsPdfValidator";

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
        atsValidation: true,
        jobId: true,
        resumeProfileId: true,
        company: true,
        role: true,
        job: {
          select: {
            id: true,
            userId: true,
            title: true,
            company: true,
            market: true,
            description: true,
          },
        },
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
    const requiresCanonicalEvidence =
      aiContentParsed.data.evidence !== undefined ||
      aiContentParsed.data.review !== undefined;
    const requiresJobEvidence =
      aiContentParsed.data.evidence?.some((item) => item.kind === "job") ===
        true ||
      (aiContentParsed.data.review?.requirements.length ?? 0) > 0;
    const profile =
      existing.resumeProfile?.userId === userId
        ? existing.resumeProfile
        : null;
    if (
      requiresCanonicalEvidence &&
      (!profile ||
        (requiresJobEvidence && !existing.job) ||
        (existing.job && existing.job.userId !== userId))
    ) {
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
    const canonicalContent =
      requiresCanonicalEvidence && profile
        ? rebuildCanonicalAiContent({
            canonical: aiContentParsed.data,
            resumeSnapshot: aiContentParsed.data.source
              ? {
                  profile,
                  renderInput: mapResumeProfile(profile),
                }
              : profile,
            jobDescription: existing.job?.description,
            scopeKey: userId,
            preserveReviewedAt: true,
          })
        : aiContentParsed.data;
    const canonicalHash = hashAiContent(canonicalContent);

    if (canonicalContent.review?.verdict === "blocked") {
      return NextResponse.json(
        {
          error: {
            code: "APPLICATION_REVIEW_BLOCKED",
            message:
              "Resolve unsupported claims before finalizing this application.",
            details: canonicalContent.review,
          },
          requestId,
        },
        { status: 422 },
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
            canonicalHash,
          )
        : isCurrentVersionedArtifact(
            existing.coverPdfUrl,
            "cover",
            canonicalHash,
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
    const artifactVersion = `${canonicalHash}-${randomUUID()}`;
    const renderJob = {
      id: job.id ?? null,
      title: job.title ?? "Untitled",
      company: job.company,
      market: job.market ?? "AU",
    };

    if (target === "cover") {
      let renderedCover: Awaited<ReturnType<typeof renderFinalCoverLetter>>;
      try {
        renderedCover = await renderFinalCoverLetter({
          applicationId: existing.id,
          userId,
          resumeProfileId: existing.resumeProfileId ?? null,
          aiContent: canonicalContent,
          artifactVersion,
          job: renderJob,
        });
      } catch (error) {
        const response = atsValidationErrorResponse(error, requestId);
        if (response) return response;
        throw error;
      }
      const { coverPdfUrl, coverPdfName, atsValidation } = renderedCover;
      let committed: { count: number };
      try {
        committed = await prisma.$transaction(
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
                coverPdfUrl: existing.coverPdfUrl,
              },
              data: {
                status: "FINAL",
                aiContent: canonicalContent,
                aiContentHash: canonicalHash,
                coverPdfUrl,
                atsValidation: mergeAtsValidation(
                  existing.atsValidation,
                  "cover",
                  atsValidation,
                ),
                reviewReport: canonicalContent.review ?? undefined,
              },
            });
            if (result.count === 1) {
              await persistReviewLedger(tx, {
                userId,
                applicationId: existing.id,
                jobId: existing.jobId,
                aiContent: canonicalContent,
              });
            }
            return result;
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
        atsValidation,
        aiContentHash: canonicalHash,
        requestId,
      });
    }

    let renderedResume: Awaited<ReturnType<typeof renderFinalApplication>>;
    try {
      renderedResume = await renderFinalApplication({
        applicationId: existing.id,
        userId,
        resumeProfileId: existing.resumeProfileId ?? null,
        aiContent: canonicalContent,
        artifactVersion,
        job: renderJob,
      });
    } catch (error) {
      const response = atsValidationErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
    const { resumePdfUrl, resumePdfName, atsValidation } = renderedResume;

    let committed: { count: number };
    try {
      committed = await prisma.$transaction(
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
              resumePdfUrl: existing.resumePdfUrl,
            },
            data: {
              status: "FINAL",
              aiContent: canonicalContent,
              aiContentHash: canonicalHash,
              resumePdfUrl,
              resumePdfName,
              atsValidation: mergeAtsValidation(
                existing.atsValidation,
                "resume",
                atsValidation,
              ),
              reviewReport: canonicalContent.review ?? undefined,
            },
          });
          if (result.count === 1) {
            await persistReviewLedger(tx, {
              userId,
              applicationId: existing.id,
              jobId: existing.jobId,
              aiContent: canonicalContent,
            });
          }
          return result;
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
      atsValidation,
      aiContentHash: canonicalHash,
      requestId,
    });
  });
}

function mergeAtsValidation(
  existing: unknown,
  target: "resume" | "cover",
  report: AtsPdfValidation | undefined,
): Prisma.InputJsonValue {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing
      : {};
  return { ...current, [target]: report ?? null } as Prisma.InputJsonValue;
}

function atsValidationErrorResponse(error: unknown, requestId: string) {
  if (!(error instanceof AtsPdfValidationError)) return null;
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.report,
      },
      requestId,
    },
    { status: error.status },
  );
}
