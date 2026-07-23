import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { handleLatexError } from "@/lib/server/api/handleLatexError";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { enforceAiRateLimit } from "@/lib/server/api/aiRateLimit";
import {
  buildPdfFilename,
  contentDispositionAttachment,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import { reportError } from "@/lib/server/observability/errorReporter";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const limited = enforceAiRateLimit(userId, requestId);
    if (limited) return limited;

    const json = await req.json().catch(() => null);
    const parsed = GenerateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Invalid request body",
            details: parsed.error.flatten(),
          },
          requestId,
        },
        { status: 400 },
      );
    }

    const job = await prisma.job.findFirst({
      where: {
        id: parsed.data.jobId,
        userId,
      },
      select: {
        id: true,
        title: true,
        company: true,
        description: true,
        market: true,
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: { code: "JOB_NOT_FOUND", message: "Job not found" }, requestId },
        { status: 404 },
      );
    }

    const profileLocale = marketStringToResumeLocale(job.market);
    const profile = await getResumeProfile(userId, { locale: profileLocale });
    if (!profile) {
      return NextResponse.json(
        {
          error: {
            code: "NO_PROFILE",
            message: "Create and save your master resume before generating.",
          },
          requestId,
        },
        { status: 404 },
      );
    }

    let pdfResult: Awaited<ReturnType<typeof buildResumePdfForJob>>;
    try {
      pdfResult = await buildResumePdfForJob({ userId, profile, job });
    } catch (err) {
      const latexRes = handleLatexError(err, requestId);
      if (latexRes) return latexRes;
      // Non-LaTeX failure (AI / build) — report so the failure rate is visible
      // in prod instead of vanishing into a generic 500.
      reportError(err, { scope: "applications.generate", userId, requestId });
      return NextResponse.json(
        { error: { code: "UNKNOWN_ERROR", message: "Unknown render error" }, requestId },
        { status: 500 },
      );
    }

    const application = await prisma.application.upsert({
      where: {
        userId_jobId: {
          userId,
          jobId: job.id,
        },
      },
      create: {
        userId,
        jobId: job.id,
        resumeProfileId: profile.id,
        company: job.company,
        role: job.title,
      },
      update: {
        resumeProfileId: profile.id,
        company: job.company,
        role: job.title,
      },
      select: {
        id: true,
      },
    });

    const filename = buildPdfFilename(resumeFilenameSegments(profile).name, job.title);

    return new NextResponse(new Uint8Array(pdfResult.pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": contentDispositionAttachment(filename),
        "x-application-id": application.id,
        "x-request-id": requestId,
        "x-tailor-cv-source": pdfResult.cvSource,
        "x-tailor-cover-source": pdfResult.coverSource,
        "x-tailor-reason": pdfResult.tailorReason,
      },
    });
  });
}
