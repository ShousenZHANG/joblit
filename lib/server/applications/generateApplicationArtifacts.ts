import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { getLocaleProfile } from "@/lib/shared/locales";
import { coverParagraphTexts } from "@/lib/shared/aiContentText";
import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import { assertAtsPdf } from "@/lib/server/applications/atsPdfValidator";
import { commitApplicationArtifact } from "@/lib/server/applications/commitApplicationArtifact";
import { AppError } from "@/lib/server/api/appError";
import { acceptApplicationGeneration } from "./applicationGeneration";
import { evolveApplicationAiContent } from "./applicationAiContentAggregate";

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
      targetWordRange: getLocaleProfile(profileLocale).coverWordRange,
    },
  });
  const resumePdfName = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    job.title,
  );
  const tailored = resumeResult.tailored;
  const coverAcceptance = acceptApplicationGeneration({
    evidenceScopeKey: input.userId,
    target: "cover",
    source: "server_batch",
    rawOutput: JSON.stringify({ cover: tailored.cover }),
    promptMetaHash: tailored.promptMetaHash.cover,
    master: resumeResult.renderInput,
    profile,
    job,
  });
  if (!coverAcceptance.ok) {
    throw new Error(
      `INTERNAL_COVER_GENERATION_INVALID:${coverAcceptance.error.code}`,
    );
  }
  const aggregate = evolveApplicationAiContent({
    current: resumeResult.aiContent,
    command: {
      kind: "replace_target_proposal",
      target: "cover",
      proposal: coverAcceptance.aiContent,
    },
    reviewContext: {
      scopeKey: input.userId,
      resumeSnapshot: {
        profile,
        renderInput: resumeResult.renderInput,
      },
      jobDescription: job.description,
      jobSourceAvailable: true,
    },
  });
  if (aggregate.kind !== "evolved") {
    throw new Error("APPLICATION_REVIEW_CONTEXT_REQUIRED");
  }
  const aiContent = aggregate.aiContent;
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

  const [paragraphOne, paragraphTwo, paragraphThree] = coverParagraphTexts(
    aiContent.cover,
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
    paragraphOne,
    paragraphTwo,
    paragraphThree,
  });
  const coverPdf = await compileLatexToPdf(coverTex);
  const coverAtsValidation = await assertAtsPdf(coverPdf, {
    maxPages: 2,
    minTextChars: 160,
    requiredKeywords,
  });
  const coverPdfName = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    job.title,
    "cl",
  );
  const artifactVersion = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const commit = await commitApplicationArtifact({
    userId: input.userId,
    job: { id: job.id, title: job.title, company: job.company },
    resumeProfileId: profile.id,
    aiContent,
    artifacts: [
      {
        target: "resume",
        pdf: resumeResult.pdf,
        filename: resumePdfName,
        atsValidation: resumeAtsValidation,
        version: artifactVersion,
      },
      {
        target: "cover",
        pdf: coverPdf,
        atsValidation: coverAtsValidation,
        version: artifactVersion,
      },
    ],
    status: "FINAL",
    // This path builds both halves, so there is nothing to merge against.
    extraData: {
      reviewReport: {
        deterministic: aiContent.review ?? null,
        independent: tailored.reviewer ?? null,
        quality: tailored.qualityReport ?? null,
      },
    },
  });
  if (commit.kind === "job_missing") {
    // The Job was deleted while the render was in flight. The Codex Batch
    // runner records this message on the task, so keep the code stable.
    throw new Error("JOB_NOT_FOUND");
  }
  if (commit.kind === "review_blocked") {
    throw new AppError({
      code: "APPLICATION_REVIEW_BLOCKED",
      status: 422,
      publicMessage:
        "The draft contains claims that are not grounded in the master resume.",
      publicDetails: commit.review,
    });
  }
  if (commit.kind !== "committed") {
    throw new AppError({
      code: "APPLICATION_PERSIST_FAILED",
      status: 500,
      publicMessage: "The application could not be saved.",
      privateDetails: commit.kind === "upload_failed" ? commit.cause : commit.kind,
    });
  }
  // Blob lifecycle — upload, rollback on failure, GC of the superseded
  // artifact — is owned by commitApplicationArtifact.
  return {
    applicationId: commit.applicationId,
    jobId: job.id,
    resumePdfUrl: commit.urls.resume ?? null,
    resumePdfName,
    coverPdfUrl: commit.urls.cover ?? null,
    coverPdfName,
  } satisfies GenerateArtifactsResult;
}
