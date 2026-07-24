import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { commitApplicationArtifact } from "@/lib/server/applications/commitApplicationArtifact";
import { errorJson, notFoundError } from "@/lib/server/api/errorResponse";
import { enforceApplicationRenderRateLimit } from "@/lib/server/api/applicationRenderRateLimit";
import {
  buildAtsKeywords,
  renderApplicationPdf,
  renderCoverLetterPdf,
} from "@/lib/server/applications/finalizeApplication";
import {
  aiContentSchema,
  hashAiContent,
} from "@/lib/shared/schemas/aiContent";
import { evolveApplicationAiContent } from "@/lib/server/applications/applicationAiContentAggregate";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  assertAtsPdf,
  AtsPdfValidationError,
  type AtsPdfValidation,
} from "@/lib/server/applications/atsPdfValidator";

export const runtime = "nodejs";

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
  return withSessionRoute(
    async ({ userId, requestId, params }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;
      const { expectedHash } = parsedBody.data;

      const existing = await prisma.application.findFirst({
        where: { id: params.id, userId },
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
      const profile =
        existing.resumeProfile?.userId === userId
          ? existing.resumeProfile
          : null;
      const jobOwned = existing.job?.userId === userId;
      const evolved = evolveApplicationAiContent({
        current: aiContentParsed.data,
        command: { kind: "refresh_review", preserveReviewedAt: true },
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
      const canonicalContent = evolved.aiContent;
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

      let pdf: Buffer;
      let filename: string;
      let atsValidation: AtsPdfValidation;
      try {
        const rendered =
          target === "cover"
            ? await renderCoverLetterPdf({
                applicationId: existing.id,
                userId,
                resumeProfileId: existing.resumeProfileId ?? null,
                aiContent: canonicalContent,
                job: renderJob,
              })
            : await renderApplicationPdf({
                applicationId: existing.id,
                userId,
                resumeProfileId: existing.resumeProfileId ?? null,
                aiContent: canonicalContent,
                job: renderJob,
              });
        pdf = rendered.pdf;
        filename = rendered.filename;
        atsValidation = await assertAtsPdf(pdf, {
          maxPages: 2,
          minTextChars: target === "cover" ? 160 : 180,
          requiredKeywords: buildAtsKeywords(canonicalContent, renderJob.title),
        });
      } catch (error) {
        const response = atsValidationErrorResponse(error, requestId);
        if (response) return response;
        throw error;
      }

      const commit = await commitApplicationArtifact({
        userId,
        job: { id: existing.jobId ?? existing.id, title: renderJob.title, company: renderJob.company },
        resumeProfileId: existing.resumeProfileId ?? "",
        aiContent: canonicalContent,
        artifacts: [{ target, pdf, filename, atsValidation, version: artifactVersion }],
        status: "FINAL",
        // The canonical rebuild above already carries both halves.
        expectedHash,
      });

      if (commit.kind === "stale_write") return staleFinalizeResponse(requestId);
      if (commit.kind === "job_missing") return notFoundError("job", requestId);
      if (commit.kind === "review_blocked") {
        return errorJson(
          "APPLICATION_REVIEW_BLOCKED",
          "Resolve unsupported claims before finalizing this application.",
          422,
          { details: commit.review, requestId },
        );
      }
      if (commit.kind !== "committed") {
        return errorJson(
          "APPLICATION_PERSIST_FAILED",
          "The PDF was rendered but could not be saved. Please try again.",
          500,
          { requestId },
        );
      }

      return NextResponse.json({
        status: "FINAL",
        ...(target === "cover"
          ? { coverPdfUrl: commit.urls.cover ?? null }
          : {
              resumePdfUrl: commit.urls.resume ?? null,
              resumePdfName: filename,
            }),
        atsValidation,
        aiContentHash: commit.aiContentHash,
        requestId,
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
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
