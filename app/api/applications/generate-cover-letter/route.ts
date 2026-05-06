import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { LatexRenderError, compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { tailorApplicationContent } from "@/lib/server/ai/tailorApplication";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

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

  const renderInput = mapResumeProfile(profile);
  const tailored = await tailorApplicationContent({
    baseSummary: renderInput.summary,
    jobTitle: job.title,
    company: job.company || "the company",
    description: job.description || "",
    resumeSnapshot: profile,
    userId,
  }, {
    strictCoverQuality: true,
    maxCoverRewritePasses: 2,
    localeProfile: profileLocale,
    targetWordRange: { min: 280, max: 360 },
  });
  const coverQualityGatePassed = tailored.qualityReport?.passed ?? true;

  const coverTex = renderCoverLetterTex({
    candidate: {
      name: renderInput.candidate.name,
      title: renderInput.candidate.title,
      phone: renderInput.candidate.phone,
      email: renderInput.candidate.email,
      linkedinUrl: renderInput.candidate.linkedinUrl,
      linkedinText: renderInput.candidate.linkedinText,
    },
    company: job.company || "the company",
    role: job.title,
    candidateTitle: tailored.cover.candidateTitle,
    subject: tailored.cover.subject,
    date: tailored.cover.date,
    salutation: tailored.cover.salutation,
    paragraphOne: tailored.cover.paragraphOne,
    paragraphTwo: tailored.cover.paragraphTwo,
    paragraphThree: tailored.cover.paragraphThree,
    closing: tailored.cover.closing,
    signatureName: tailored.cover.signatureName,
  });

  let pdf: Buffer;
  try {
    pdf = await compileLatexToPdf(coverTex);
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

  const filename = buildPdfFilename(renderInput.candidate.name, job.title, "Cover Letter");

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-application-id": application.id,
      "x-request-id": requestId,
      "x-tailor-cv-source": tailored.source.cv,
      "x-tailor-cover-source": tailored.source.cover,
      "x-tailor-reason": tailored.reason,
      "x-cover-quality-gate": coverQualityGatePassed ? "pass" : "soft-fail",
    },
  });
}
