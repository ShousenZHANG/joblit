import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { LatexRenderError } from "@/lib/server/latex/compilePdf";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(req: Request) {
  const requestId = randomUUID();
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" }, requestId },
      { status: 401 },
    );
  }

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

  const profileLocale = job.market === "CN" ? "zh-CN" : "en-AU";
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
    if (err instanceof LatexRenderError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
          requestId,
        },
        { status: err.status },
      );
    }
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

  const filename = buildPdfFilename(pdfResult.renderInput.candidate.name, job.title);

  return new NextResponse(new Uint8Array(pdfResult.pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-application-id": application.id,
      "x-request-id": requestId,
      "x-tailor-cv-source": pdfResult.cvSource,
      "x-tailor-cover-source": pdfResult.coverSource,
      "x-tailor-reason": pdfResult.tailorReason,
    },
  });
}
