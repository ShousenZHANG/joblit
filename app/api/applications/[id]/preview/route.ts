import { NextResponse } from "next/server";
import { z } from "zod";

import {
  parseJsonBody,
  withSessionRoute,
} from "@/lib/server/api/routeHandler";
import { enforceApplicationRenderRateLimit } from "@/lib/server/api/applicationRenderRateLimit";
import {
  renderApplicationPdf,
  renderCoverLetterPdf,
} from "@/lib/server/applications/finalizeApplication";
import { contentDispositionInline } from "@/lib/server/files/pdfFilename";
import { prisma } from "@/lib/server/prisma";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

const BodySchema = z.object({ expectedHash: z.string().nullable() });

function parseTarget(req: Request): "resume" | "cover" {
  return new URL(req.url).searchParams.get("target") === "cover"
    ? "cover"
    : "resume";
}

/**
 * Render an authenticated, no-store PDF preview without changing Application
 * status and without uploading a public Blob. Finalize remains the only
 * operation that persists an artifact.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, requestId, params }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;

      const application = await prisma.application.findFirst({
        where: { id: params.id, userId },
        select: {
          id: true,
          aiContent: true,
          aiContentHash: true,
          jobId: true,
          resumeProfileId: true,
          company: true,
          role: true,
          job: {
            select: { id: true, title: true, company: true, market: true },
          },
        },
      });
      if (!application) {
        return NextResponse.json(
          {
            error: { code: "NOT_FOUND", message: "Application not found" },
            requestId,
          },
          { status: 404 },
        );
      }
      if (parsedBody.data.expectedHash !== application.aiContentHash) {
        return NextResponse.json(
          {
            error: {
              code: "STALE_WRITE",
              message: "Another tab updated this draft",
            },
            currentHash: application.aiContentHash,
            requestId,
          },
          { status: 409 },
        );
      }

      const aiContent = aiContentSchema.safeParse(application.aiContent);
      if (!aiContent.success) {
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

      // Only an owned, current, renderable draft consumes the shared expensive
      // PDF budget. Random UUID probes cannot create unbounded limiter keys.
      const limited = enforceApplicationRenderRateLimit(userId, requestId);
      if (limited) return limited;

      const storedJob = application.job ?? {
        id: application.jobId,
        title: application.role ?? "Untitled",
        company: application.company,
        market: "AU",
      };
      const job = {
        id: storedJob.id ?? null,
        title: storedJob.title ?? "Untitled",
        company: storedJob.company,
        market: storedJob.market ?? "AU",
      };
      const target = parseTarget(req);
      const rendered =
        target === "cover"
          ? await renderCoverLetterPdf({
              applicationId: application.id,
              userId,
              resumeProfileId: application.resumeProfileId ?? null,
              aiContent: aiContent.data,
              artifactVersion: application.aiContentHash,
              job,
            })
          : await renderApplicationPdf({
              applicationId: application.id,
              userId,
              resumeProfileId: application.resumeProfileId ?? null,
              aiContent: aiContent.data,
              artifactVersion: application.aiContentHash,
              job,
            });

      return new NextResponse(new Uint8Array(rendered.pdf), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Disposition": contentDispositionInline(rendered.filename),
          "Content-Type": "application/pdf",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
