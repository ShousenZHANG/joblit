import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import { assertAtsPdf } from "@/lib/server/applications/atsPdfValidator";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import { commitApplicationArtifact } from "@/lib/server/applications/commitApplicationArtifact";
import { AppError } from "@/lib/server/api/appError";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

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
      targetWordRange: { min: 280, max: 360 },
    },
  });
  const resumePdfName = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    job.title,
  );
  const tailored = resumeResult.tailored;
  const aiContent = attachEvidenceAndReview({
    scopeKey: input.userId,
    resumeSnapshot: {
      profile,
      renderInput: resumeResult.renderInput,
    },
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

function buildBatchAiContent(
  tailored: Awaited<
    ReturnType<typeof import("@/lib/server/ai/tailorApplication").tailorApplicationContent>
  >,
  originalSummary: string,
): AiContent {
  const generatedAt = new Date().toISOString();
  const generation = {
    generatedAt,
    promptMetaHash: "server-batch:reviewer-v1",
    source: "server_batch" as const,
  };
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt,
    promptMetaHash: "server-batch:reviewer-v1",
    provenance: {
      resume: generation,
      cover: generation,
    },
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
