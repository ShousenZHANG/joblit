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
import { buildPromptSnapshotHash } from "@/lib/server/ai/promptContract";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import {
  bindTailoringRunPrompt,
  failTailoringRun,
  issueTailoringRun,
  startTailoringRun,
} from "@/lib/server/tailoringRuns/tailoringRunService";
import { hashTailoringRunValue } from "@/lib/server/tailoringRuns/tailoringRunHash";
import type { TailoringAcceptanceRequest } from "@/lib/server/tailoringRuns/tailoringRunTypes";
import type { TailoringRunHandle } from "@/lib/shared/tailoringRunContract";
import {
  applicationBatchTargetProgress,
} from "@/lib/server/applicationBatches/tailoringTaskContract";
import type { CommitArtifact } from "@/lib/server/applications/commitApplicationArtifact";

type BatchTarget = "RESUME" | "COVER";

type GenerateArtifactsInput = {
  userId: string;
  jobId: string;
  batch?: {
    batchId: string;
    taskId: string;
    executionAttemptId: string;
    issueKey: string;
    acceptedTargets: readonly BatchTarget[];
    remainingTargets: readonly BatchTarget[];
  };
};

type GenerateArtifactsResult = {
  applicationId: string;
  jobId: string;
  resumePdfUrl: string | null;
  resumePdfName: string;
  coverPdfUrl: string | null;
  coverPdfName: string;
};

function acceptedTargetPayload(
  aiContent: Parameters<typeof commitApplicationArtifact>[0]["aiContent"],
  target: "RESUME" | "COVER",
) {
  const provenance =
    target === "RESUME"
      ? aiContent.provenance?.resume
      : aiContent.provenance?.cover;
  return {
    target,
    proposal: target === "RESUME" ? aiContent.cv : aiContent.cover,
    provenance: provenance
      ? {
          promptMetaHash: provenance.promptMetaHash,
          source: provenance.source,
        }
      : null,
  };
}

function sameTargets(
  left: readonly BatchTarget[],
  right: readonly BatchTarget[],
): boolean {
  return (
    left.length === right.length &&
    left.every((target, index) => target === right[index])
  );
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

  const resumeSnapshotHash = buildPromptSnapshotHash(
    buildResumePromptSnapshot(profile),
  );
  const jobSnapshotHash = buildPromptSnapshotHash({
    title: job.title,
    company: job.company || "the company",
    description: job.description || "",
  });
  let tailoringHandle: TailoringRunHandle | null = null;
  let remainingTargets: BatchTarget[] = ["RESUME", "COVER"];
  if (input.batch) {
    const issued = await issueTailoringRun({
      userId: input.userId,
      issueKey: input.batch.issueKey,
      jobId: input.jobId,
      resumeProfileId: profile.id,
      source: "SERVER_BATCH",
      delivery: "FINAL",
      requiredTargets: ["RESUME", "COVER"],
      resumeSnapshotHash,
      jobSnapshotHash,
      batch: {
        batchId: input.batch.batchId,
        taskId: input.batch.taskId,
        executionAttemptId: input.batch.executionAttemptId,
      },
      promptReceipts: {},
    });
    const authoritativeProgress = applicationBatchTargetProgress({
      requiredTargetMask: issued.run.requiredTargetMask,
      acceptedTargetMask: issued.run.acceptedTargetMask,
    });
    if (
      !sameTargets(
        authoritativeProgress.acceptedTargets,
        input.batch.acceptedTargets,
      ) ||
      !sameTargets(
        authoritativeProgress.remainingTargets,
        input.batch.remainingTargets,
      ) ||
      authoritativeProgress.remainingTargets.length === 0
    ) {
      throw new Error("BATCH_TARGET_PROGRESS_STALE");
    }
    remainingTargets = authoritativeProgress.remainingTargets;
    tailoringHandle = (
      await startTailoringRun({
        userId: input.userId,
        runId: issued.run.id,
        attemptId: input.batch.executionAttemptId,
        batchExecutionAttemptId: input.batch.executionAttemptId,
      })
    ).handle;
  }

  try {
  const resumeResult = await buildResumePdfForJob({
    userId: input.userId,
    profile,
    job,
    tailorOptions: {
      targets: remainingTargets.map((target) =>
        target === "RESUME" ? "resume" : "cover",
      ),
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
  let aiContent = resumeResult.aiContent;
  if (remainingTargets.includes("COVER")) {
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
    aiContent = aggregate.aiContent;
  }
  if (aiContent.review?.verdict === "blocked") {
    throw new Error("APPLICATION_REVIEW_BLOCKED");
  }
  const requiredKeywords = (aiContent.review?.requirements ?? [])
    .flatMap((item) => item.text.split(/[\s,/|():;-]+/))
    .filter((item) => item.length >= 3)
    .slice(0, 30);
  if (remainingTargets.includes("RESUME") && !resumeResult.pdf) {
    throw new Error("RESUME_RENDER_MISSING");
  }
  const resumeAtsValidation =
    remainingTargets.includes("RESUME") && resumeResult.pdf
      ? await assertAtsPdf(resumeResult.pdf, {
        maxPages: 2,
        minTextChars: 180,
        requiredKeywords,
      })
      : null;

  let coverPdf: Buffer | null = null;
  if (remainingTargets.includes("COVER")) {
    const [paragraphOne, paragraphTwo, paragraphThree] = coverParagraphTexts(
      aiContent.cover,
    );
    coverPdf = await compileLatexToPdf(
      renderCoverLetterTex({
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
      }),
    );
  }
  const coverAtsValidation = coverPdf
    ? await assertAtsPdf(coverPdf, {
        maxPages: 2,
        minTextChars: 160,
        requiredKeywords,
      })
    : null;
  const coverPdfName = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    job.title,
    "cl",
  );
  const artifactVersion = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tailoringAcceptance: readonly TailoringAcceptanceRequest[] | undefined;
  if (input.batch && tailoringHandle) {
    for (const target of remainingTargets) {
      const promptHash =
        target === "RESUME"
          ? tailored.promptMetaHash.resume
          : tailored.promptMetaHash.cover;
      await bindTailoringRunPrompt({
        userId: input.userId,
        runId: tailoringHandle.id,
        target,
        receipt: {
          promptHash,
          promptMetaHash: promptHash,
        },
        batchExecutionAttemptId: input.batch.executionAttemptId,
      });
    }
    tailoringAcceptance = remainingTargets.map((target) => {
      const promptHash =
        target === "RESUME"
          ? tailored.promptMetaHash.resume
          : tailored.promptMetaHash.cover;
      return {
        handle: tailoringHandle!,
        source: "SERVER_BATCH" as const,
        delivery: "FINAL" as const,
        target,
        requestHash: hashTailoringRunValue({
          protocol: "tailoring-run/v1",
          delivery: "FINAL",
          promptHash,
          payload: acceptedTargetPayload(aiContent, target),
        }),
        promptHash,
        resumeSnapshotHash,
        jobSnapshotHash,
        batchExecutionAttemptId: input.batch!.executionAttemptId,
      };
    });
  }
  const commitArtifacts: CommitArtifact[] = [];
  if (remainingTargets.includes("RESUME") && resumeResult.pdf) {
    commitArtifacts.push({
      target: "resume",
      pdf: resumeResult.pdf,
      filename: resumePdfName,
      atsValidation: resumeAtsValidation,
      version: artifactVersion,
    });
  }
  if (remainingTargets.includes("COVER") && coverPdf) {
    commitArtifacts.push({
      target: "cover",
      pdf: coverPdf,
      atsValidation: coverAtsValidation,
      version: artifactVersion,
    });
  }
  const commitBase = {
    userId: input.userId,
    job: { id: job.id, title: job.title, company: job.company },
    resumeProfileId: profile.id,
    aiContent,
    artifacts: commitArtifacts,
    status: "FINAL" as const,
    extraData: {
      reviewReport: {
        deterministic: aiContent.review ?? null,
        independent: tailored.reviewer ?? null,
        quality: tailored.qualityReport ?? null,
      },
    },
    ...(tailoringAcceptance ? { tailoring: tailoringAcceptance } : {}),
  };
  const commit =
    remainingTargets.length === 1
      ? await commitApplicationArtifact({
          ...commitBase,
          mergeTarget:
            remainingTargets[0] === "RESUME" ? "resume" : "cover",
          reviewContext: {
            scopeKey: input.userId,
            resumeSnapshot: {
              profile,
              renderInput: resumeResult.renderInput,
            },
            jobDescription: job.description,
            jobSourceAvailable: true,
          },
        })
      : await commitApplicationArtifact(commitBase);
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
  } catch (error) {
    if (input.batch && tailoringHandle) {
      await failTailoringRun({
        userId: input.userId,
        handle: tailoringHandle,
        errorCode: "SERVER_BATCH_FAILED",
        errorMessage: "Server batch generation failed",
        batchExecutionAttemptId: input.batch.executionAttemptId,
      }).catch(() => undefined);
    }
    throw error;
  }
}
