import { randomUUID } from "node:crypto";
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
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
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
      version: `${Date.now()}-${randomUUID().slice(0, 8)}`,
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

async function deleteBlobUrls(urls: Array<string | null | undefined>) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  const uniqueUrls = Array.from(
    new Set(
      urls.filter(
        (url): url is string =>
          typeof url === "string" && url.trim().length > 0,
      ),
    ),
  );
  await Promise.allSettled(uniqueUrls.map((url) => del(url, { token })));
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
  const resumePdfName = buildPdfFilename(
    resumeResult.renderInput.candidate.name,
    job.title,
  );
  let resumePdfUrl: string | null = null;
  let coverPdfUrl: string | null = null;
  let committed = false;

  try {
    resumePdfUrl = await uploadPdfToBlob({
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
    const coverPdfName = buildPdfFilename(
      resumeResult.renderInput.candidate.name,
      job.title,
      "cl",
    );
    coverPdfUrl = await uploadPdfToBlob({
      userId: input.userId,
      jobId: job.id,
      target: "cover",
      pdf: coverPdf,
    }).catch(() => null);

    // PDF/AI work stays outside the transaction. Only the ownership recheck
    // and Application commit are serialized, keeping lock time bounded.
    const commit = await prisma.$transaction(
      async (tx) => {
        await acquireApplicationMutationLock(
          tx,
          input.userId,
          job.id,
        );
        const ownedJob = await tx.job.findFirst({
          where: { id: job.id, userId: input.userId },
          select: { id: true },
        });
        if (!ownedJob) throw new Error("JOB_NOT_FOUND");

        const currentApplication = await tx.application.findUnique({
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
        const application = await tx.application.upsert({
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
            ...(coverPdfUrl ? { coverPdfUrl } : {}),
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
            ...(coverPdfUrl ? { coverPdfUrl } : {}),
          },
          select: { id: true },
        });

        return {
          applicationId: application.id,
          staleUrls: [
            currentApplication?.resumePdfUrl &&
            resumePdfUrl &&
            currentApplication.resumePdfUrl !== resumePdfUrl
              ? currentApplication.resumePdfUrl
              : null,
            currentApplication?.coverPdfUrl &&
            coverPdfUrl &&
            currentApplication.coverPdfUrl !== coverPdfUrl
              ? currentApplication.coverPdfUrl
              : null,
          ],
        };
      },
      { timeout: 30_000 },
    );
    committed = true;
    await deleteBlobUrls(commit.staleUrls);

    return {
      applicationId: commit.applicationId,
      jobId: job.id,
      resumePdfUrl,
      resumePdfName,
      coverPdfUrl,
      coverPdfName,
    } satisfies GenerateArtifactsResult;
  } catch (error) {
    if (!committed) {
      await deleteBlobUrls([resumePdfUrl, coverPdfUrl]);
    }
    throw error;
  }
}
