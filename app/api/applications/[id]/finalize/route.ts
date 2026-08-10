import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withAgentRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import {
  APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE,
  commitApplicationArtifact,
} from "@/lib/server/applications/commitApplicationArtifact";
import { errorJson, notFoundError } from "@/lib/server/api/errorResponse";
import { enforceApplicationRenderRateLimit } from "@/lib/server/api/applicationRenderRateLimit";
import {
  buildAtsKeywords,
  renderApplicationPdf,
  renderCoverLetterPdf,
} from "@/lib/server/applications/finalizeApplication";
import {
  aiContentSchema,
} from "@/lib/shared/schemas/aiContent";
import { evolveApplicationAiContent } from "@/lib/server/applications/applicationAiContentAggregate";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  buildApplicationPublicationRenderContext,
  projectApplicationPublication,
} from "@/lib/server/applications/applicationPublication";
import { confirmApplicationPublicationReplay } from "@/lib/server/applications/applicationPublicationReplay";
import {
  assertAtsPdf,
  AtsPdfValidationError,
  type AtsPdfValidation,
} from "@/lib/server/applications/atsPdfValidator";

export const runtime = "nodejs";

const BodySchema = z
  .object({
  /**
   * Hash from the client's last-known load. Stale-write guard against
   * concurrent autosaves from a second tab.
   */
    expectedHash: z.string().nullable(),
    tailoringRun: z
      .object({ id: z.string().uuid(), attemptId: z.string().uuid() })
      .strict()
      .optional(),
    batchAttemptId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (Boolean(body.tailoringRun) === Boolean(body.batchAttemptId)) return;
    context.addIssue({
      code: "custom",
      message: "tailoringRun and batchAttemptId must be supplied together",
      path: [body.tailoringRun ? "batchAttemptId" : "tailoringRun"],
    });
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

function staleRenderContextResponse(requestId: string) {
  return errorJson(
    "STALE_RENDER_CONTEXT",
    "Your resume profile or job changed while the PDF was rendering. Finalize again.",
    409,
    { requestId },
  );
}

/**
 * Render and publish one current Application document. Aggregate status is a
 * compatibility projection over both target publications.
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
  return withAgentRoute(
    req,
    "tailoring:execute",
    async ({ userId, requestId, params, authKind }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;
      const { expectedHash } = parsedBody.data;
      if (authKind === "agent" && !parsedBody.data.tailoringRun) {
        return errorJson(
          "AGENT_PROTOCOL_REQUIRED",
          "Agent publication requires its TailoringRun handle.",
          403,
          { requestId },
        );
      }

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
          resumeContentHash: true,
          coverContentHash: true,
          resumePublishedHash: true,
          coverPublishedHash: true,
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
      if (!profile || !jobOwned || !existing.job) {
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
      const evolved = evolveApplicationAiContent({
        current: aiContentParsed.data,
        command: { kind: "refresh_review", preserveReviewedAt: true },
        reviewContext: {
          scopeKey: userId,
          resumeSnapshot: {
            profile,
            renderInput: mapResumeProfile(profile),
          },
          jobDescription: existing.job.description,
          jobSourceAvailable: true,
        },
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

      const job = existing.job;
      const renderSnapshot = {
        profile,
        job: {
          id: job.id ?? null,
          title: job.title ?? "Untitled",
          company: job.company,
          market: job.market ?? "AU",
        },
      };
      const publicationRenderContext =
        buildApplicationPublicationRenderContext({
          profile: renderSnapshot.profile,
          job: renderSnapshot.job,
        });

      const target = parseTarget(req);
      const currentPublication = projectApplicationPublication({
        aiContent: canonicalContent,
        record: {
          status: existing.status,
          aiContentHash: existing.aiContentHash,
          resumePdfUrl: existing.resumePdfUrl,
          coverPdfUrl: existing.coverPdfUrl,
          resumeContentHash: existing.resumeContentHash,
          coverContentHash: existing.coverContentHash,
          resumePublishedHash: existing.resumePublishedHash,
          coverPublishedHash: existing.coverPublishedHash,
        },
        renderContext: publicationRenderContext,
      });
      // Repeat clicks for an already-committed artifact are a read, not another
      // LaTeX compile + Blob upload. Publication identity is target-scoped:
      // aggregate review or the other target cannot make this PDF stale.
      if (
        currentPublication[target].status === "FINAL"
      ) {
        const replay = await confirmApplicationPublicationReplay({
          userId,
          applicationId: existing.id,
          jobId: existing.jobId ?? job.id,
          resumeProfileId: existing.resumeProfileId ?? "",
          expectedHash,
          target,
          renderContext: publicationRenderContext,
          ...(parsedBody.data.tailoringRun && parsedBody.data.batchAttemptId
            ? {
                tailoringPublication: {
                  handle: parsedBody.data.tailoringRun,
                  applicationId: existing.id,
                  target: target === "cover" ? ("COVER" as const) : ("RESUME" as const),
                  batchExecutionAttemptId: parsedBody.data.batchAttemptId,
                },
              }
            : {}),
        });
        if (replay.kind === "stale_write") {
          return staleFinalizeResponse(requestId);
        }
        if (replay.kind === "stale_render_context") {
          return staleRenderContextResponse(requestId);
        }
        if (replay.kind === "not_found") {
          return notFoundError("application", requestId);
        }
        if (replay.kind === "invalid_ai_content") {
          return errorJson(
            "AI_CONTENT_INVALID",
            "Stored aiContent failed schema validation",
            500,
            { requestId },
          );
        }
        if (replay.kind === "replayed") {
          return NextResponse.json({
            status: replay.publication.status,
            publication: replay.publication,
            aiContentHash: replay.aiContentHash,
            ...(target === "resume"
              ? {
                  resumePdfUrl: replay.resumePdfUrl,
                  resumePdfName: replay.resumePdfName,
                }
              : { coverPdfUrl: replay.coverPdfUrl }),
            requestId,
          });
        }
      }

      const limited = enforceApplicationRenderRateLimit(userId, requestId);
      if (limited) return limited;

      const renderJob = renderSnapshot.job;

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
                profileSnapshot: renderSnapshot.profile,
                aiContent: canonicalContent,
                job: renderJob,
              })
            : await renderApplicationPdf({
                applicationId: existing.id,
                userId,
                resumeProfileId: existing.resumeProfileId ?? null,
                profileSnapshot: renderSnapshot.profile,
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
        publicationRenderContext,
        artifacts: [{ target, pdf, filename, atsValidation }],
        status: "FINAL",
        // The canonical rebuild above already carries both halves.
        expectedHash,
        ...(parsedBody.data.tailoringRun && parsedBody.data.batchAttemptId
          ? {
              tailoringPublication: {
                handle: parsedBody.data.tailoringRun,
                applicationId: existing.id,
                target: target === "cover" ? "COVER" : "RESUME",
                batchExecutionAttemptId: parsedBody.data.batchAttemptId,
              },
            }
          : {}),
      });

      if (commit.kind === "stale_write") return staleFinalizeResponse(requestId);
      if (commit.kind === "stale_render_context") {
        return staleRenderContextResponse(requestId);
      }
      if (commit.kind === "job_missing") return notFoundError("job", requestId);
      if (commit.kind === "review_blocked") {
        return errorJson(
          "APPLICATION_REVIEW_BLOCKED",
          "Resolve unsupported claims before finalizing this application.",
          422,
          { details: commit.review, requestId },
        );
      }
      if (commit.kind === "blob_not_configured") {
        return errorJson(
          APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.code,
          APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.message,
          APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.status,
          { requestId },
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
        status: commit.publication.status,
        publication: commit.publication,
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
