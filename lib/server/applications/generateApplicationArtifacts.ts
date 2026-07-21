import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { del, put } from "@vercel/blob";
import { assertAtsPdf } from "@/lib/server/applications/atsPdfValidator";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";

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
    tailorOptions: {
      strictCoverQuality: true,
      maxCoverRewritePasses: 2,
      maxReviewerPasses: 1,
      requireIndependentReview: true,
      requireQualityPass: true,
      localeProfile: profileLocale,
      targetWordRange: { min: 280, max: 360 },
    },
  });
  const resumePdfName = buildPdfFilename(
    resumeResult.renderInput.candidate.name,
    job.title,
  );
  let resumePdfUrl: string | null = null;
  let coverPdfUrl: string | null = null;
  let committed = false;

  try {
    const tailored = resumeResult.tailored;
    const aiContent = attachEvidenceAndReview({
      scopeKey: input.userId,
      resumeSnapshot: profile,
      jobDescription: job.description,
      aiContent: buildBatchAiContent(
        tailored,
        resumeResult.renderInput.summary,
      ),
    });
    if (aiContent.review?.verdict === "blocked") {
      throw new Error("APPLICATION_REVIEW_BLOCKED");
    }
    const requiredKeywords = (aiContent.review?.requirements ?? [])
      .flatMap((item) => item.text.split(/[\s,/|():;-]+/))
      .filter((item) => item.length >= 3)
      .slice(0, 30);
    const resumeAtsValidation = await assertAtsPdf(resumeResult.pdf, {
      maxPages: 2,
      minTextChars: 180,
      requiredKeywords,
    });

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
    const coverAtsValidation = await assertAtsPdf(coverPdf, {
      maxPages: 2,
      minTextChars: 160,
      requiredKeywords,
    });
    const coverPdfName = buildPdfFilename(
      resumeResult.renderInput.candidate.name,
      job.title,
      "cl",
    );
    resumePdfUrl = await uploadPdfToBlob({
      userId: input.userId,
      jobId: job.id,
      target: "resume",
      pdf: resumeResult.pdf,
    }).catch(() => null);
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
            status: "FINAL",
            aiContent,
            aiContentHash: hashAiContent(aiContent),
            atsValidation: {
              resume: resumeAtsValidation,
              cover: coverAtsValidation,
            },
            reviewReport: {
              deterministic: aiContent.review ?? null,
              independent: tailored.reviewer ?? null,
              quality: tailored.qualityReport ?? null,
            },
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
            status: "FINAL",
            aiContent,
            aiContentHash: hashAiContent(aiContent),
            atsValidation: {
              resume: resumeAtsValidation,
              cover: coverAtsValidation,
            },
            reviewReport: {
              deterministic: aiContent.review ?? null,
              independent: tailored.reviewer ?? null,
              quality: tailored.qualityReport ?? null,
            },
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
        await persistReviewLedger(tx, {
          userId: input.userId,
          applicationId: application.id,
          jobId: job.id,
          aiContent,
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

function buildBatchAiContent(
  tailored: Awaited<
    ReturnType<typeof import("@/lib/server/ai/tailorApplication").tailorApplicationContent>
  >,
  originalSummary: string,
): AiContent {
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    promptMetaHash: "server-batch:reviewer-v1",
    cv: {
      summary: {
        aiText: tailored.cvSummary,
        originalText: originalSummary,
        accepted: true,
      },
      latestExperience: { experienceIndex: 0, addedBullets: [] },
    },
    cover: {
      paragraphOne: {
        aiText: tailored.cover.paragraphOne,
        accepted: true,
      },
      paragraphTwo: {
        aiText: tailored.cover.paragraphTwo,
        accepted: true,
      },
      paragraphThree: {
        aiText: tailored.cover.paragraphThree,
        accepted: true,
      },
    },
  };
}
