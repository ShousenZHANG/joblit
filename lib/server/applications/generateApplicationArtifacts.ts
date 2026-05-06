import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { tailorApplicationContent } from "@/lib/server/ai/tailorApplication";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { del, put } from "@vercel/blob";

type GenerateArtifactsInput = {
  userId: string;
  jobId: string;
};

type GenerateArtifactsResult = {
  applicationId: string;
  jobId: string;
  resumePdfUrl: string | null;
  resumePdfName: string;
  coverPdfUrl: string | null;
  coverPdfName: string;
};

async function uploadPdfToBlob(input: {
  userId: string;
  jobId: string;
  target: "resume" | "cover";
  pdf: Buffer;
}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const blob = await put(
    buildApplicationArtifactBlobPath({
      userId: input.userId,
      jobId: input.jobId,
      target: input.target,
    }),
    input.pdf,
    {
      access: "public",
      contentType: "application/pdf",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      ...APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
    },
  );
  return blob.url;
}

export async function generateApplicationArtifactsForJob(input: GenerateArtifactsInput) {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      userId: input.userId,
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
    throw new Error("JOB_NOT_FOUND");
  }

  const existingApplication = await prisma.application.findUnique({
    where: {
      userId_jobId: {
        userId: input.userId,
        jobId: job.id,
      },
    },
    select: {
      resumePdfUrl: true,
      coverPdfUrl: true,
    },
  });

  const profileLocale = marketStringToResumeLocale(job.market);
  const profile = await getResumeProfile(input.userId, { locale: profileLocale });
  if (!profile) {
    throw new Error("NO_PROFILE");
  }

  const resumeResult = await buildResumePdfForJob({
    userId: input.userId,
    profile,
    job,
  });
  const resumePdfName = buildPdfFilename(resumeResult.renderInput.candidate.name, job.title);
  const resumePdfUrl = await uploadPdfToBlob({
    userId: input.userId,
    jobId: job.id,
    target: "resume",
    pdf: resumeResult.pdf,
  }).catch(() => null);

  const tailored = await tailorApplicationContent(
    {
      baseSummary: resumeResult.renderInput.summary,
      jobTitle: job.title,
      company: job.company || "the company",
      description: job.description || "",
      resumeSnapshot: profile,
      userId: input.userId,
    },
    {
      strictCoverQuality: true,
      maxCoverRewritePasses: 2,
      localeProfile: profileLocale,
      targetWordRange: { min: 280, max: 360 },
    },
  );

  const coverTex = renderCoverLetterTex({
    candidate: {
      name: resumeResult.renderInput.candidate.name,
      title: resumeResult.renderInput.candidate.title,
      phone: resumeResult.renderInput.candidate.phone,
      email: resumeResult.renderInput.candidate.email,
      linkedinUrl: resumeResult.renderInput.candidate.linkedinUrl,
      linkedinText: resumeResult.renderInput.candidate.linkedinText,
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
  const coverPdf = await compileLatexToPdf(coverTex);
  const coverPdfName = buildPdfFilename(resumeResult.renderInput.candidate.name, job.title, "Cover Letter");
  const coverPdfUrl = await uploadPdfToBlob({
    userId: input.userId,
    jobId: job.id,
    target: "cover",
    pdf: coverPdf,
  }).catch(() => null);

  const application = await prisma.application.upsert({
    where: {
      userId_jobId: {
        userId: input.userId,
        jobId: job.id,
      },
    },
    create: {
      userId: input.userId,
      jobId: job.id,
      resumeProfileId: profile.id,
      company: job.company,
      role: job.title,
      ...(resumePdfUrl
        ? {
            resumePdfUrl,
            resumePdfName,
          }
        : {}),
      ...(coverPdfUrl
        ? {
            coverPdfUrl,
          }
        : {}),
    },
    update: {
      resumeProfileId: profile.id,
      company: job.company,
      role: job.title,
      ...(resumePdfUrl
        ? {
            resumePdfUrl,
            resumePdfName,
          }
        : {}),
      ...(coverPdfUrl
        ? {
            coverPdfUrl,
          }
        : {}),
    },
    select: {
      id: true,
    },
  });

  const result: GenerateArtifactsResult = {
    applicationId: application.id,
    jobId: job.id,
    resumePdfUrl,
    resumePdfName,
    coverPdfUrl,
    coverPdfName,
  };

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const staleUrls = [
      existingApplication?.resumePdfUrl && resumePdfUrl && existingApplication.resumePdfUrl !== resumePdfUrl
        ? existingApplication.resumePdfUrl
        : null,
      existingApplication?.coverPdfUrl && coverPdfUrl && existingApplication.coverPdfUrl !== coverPdfUrl
        ? existingApplication.coverPdfUrl
        : null,
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);

    if (staleUrls.length > 0) {
      await Promise.allSettled(
        staleUrls.map((url) => del(url, { token: process.env.BLOB_READ_WRITE_TOKEN })),
      );
    }
  }

  return result;
}
