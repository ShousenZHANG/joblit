import type { Prisma } from "@/lib/generated/prisma";
import { buildPromptSnapshotHash } from "@/lib/server/ai/promptContract";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { AppError } from "@/lib/server/api/appError";
import { applicationBatchTargetProgress } from "@/lib/server/applicationBatches/tailoringTaskContract";
import { assertAtsPdf } from "@/lib/server/applications/atsPdfValidator";
import { buildApplicationPublicationRenderContext } from "@/lib/server/applications/applicationPublication";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import {
  APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE,
  commitApplicationArtifact,
  type CommitArtifact,
  type CommitResult,
} from "@/lib/server/applications/commitApplicationArtifact";
import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { hashTailoringRunValue } from "@/lib/server/tailoringRuns/tailoringRunHash";
import {
  bindTailoringRunPrompt,
  failTailoringRun,
  issueTailoringRun,
  startTailoringRun,
} from "@/lib/server/tailoringRuns/tailoringRunService";
import type { TailoringAcceptanceRequest } from "@/lib/server/tailoringRuns/tailoringRunTypes";
import { coverParagraphTexts } from "@/lib/shared/aiContentText";
import { getLocaleProfile } from "@/lib/shared/locales";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import type { TailoringRunHandle } from "@/lib/shared/tailoringRunContract";
import { evolveApplicationAiContent } from "./applicationAiContentAggregate";
import { acceptApplicationGeneration } from "./applicationGeneration";

type BatchTarget = "RESUME" | "COVER";
type AiContent = Parameters<typeof commitApplicationArtifact>[0]["aiContent"];
type ResumeProfile = NonNullable<
  Awaited<ReturnType<typeof getResumeProfile>>
>;
type ResumeGeneration = Awaited<ReturnType<typeof buildResumePdfForJob>>;
type AtsValidation = Awaited<ReturnType<typeof assertAtsPdf>>;
type SnapshotHashes = {
  resumeSnapshotHash: string;
  jobSnapshotHash: string;
};

const SERVER_BATCH_JOB_SELECT = {
  id: true,
  title: true,
  company: true,
  description: true,
  market: true,
} satisfies Prisma.JobSelect;

type ServerBatchJob = Prisma.JobGetPayload<{
  select: typeof SERVER_BATCH_JOB_SELECT;
}>;

export type ExecuteServerBatchTailoringTaskInput = {
  userId: string;
  jobId: string;
  batchId: string;
  taskId: string;
  executionAttemptId: string;
  issueKey: string;
};

export type ServerBatchTailoringTaskResult = {
  applicationId: string;
  jobId: string;
  resumePdfUrl: string | null;
  resumePdfName: string;
  coverPdfUrl: string | null;
  coverPdfName: string;
};

type ServerBatchTaskContext = {
  input: ExecuteServerBatchTailoringTaskInput;
  job: ServerBatchJob;
  profile: ResumeProfile;
  profileLocale: ReturnType<typeof marketStringToResumeLocale>;
  hashes: SnapshotHashes;
  remainingTargets: readonly BatchTarget[];
  tailoringHandle: TailoringRunHandle;
};

type GeneratedDocuments = {
  resume: ResumeGeneration;
  aiContent: AiContent;
  resumePdfName: string;
  coverPdfName: string;
  coverPdf: Buffer | null;
  resumeAtsValidation: AtsValidation | null;
  coverAtsValidation: AtsValidation | null;
};

function acceptedTargetPayload(
  aiContent: AiContent,
  target: BatchTarget,
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

async function requireJob(
  input: ExecuteServerBatchTailoringTaskInput,
): Promise<ServerBatchJob> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, userId: input.userId },
    select: SERVER_BATCH_JOB_SELECT,
  });
  if (job) return job;
  throw new AppError({
    code: "JOB_NOT_FOUND",
    status: 404,
    publicMessage: "Job not found.",
  });
}

async function requireProfile(
  userId: string,
  locale: ReturnType<typeof marketStringToResumeLocale>,
): Promise<ResumeProfile> {
  const profile = await getResumeProfile(userId, { locale });
  if (profile) return profile;
  throw new AppError({
    code: "NO_PROFILE",
    status: 404,
    publicMessage:
      "Create and save your master resume before generating documents.",
  });
}

function snapshotHashes(
  job: ServerBatchJob,
  profile: ResumeProfile,
): SnapshotHashes {
  return {
    resumeSnapshotHash: buildPromptSnapshotHash(
      buildResumePromptSnapshot(profile),
    ),
    jobSnapshotHash: buildPromptSnapshotHash({
      title: job.title,
      company: job.company || "the company",
      description: job.description || "",
    }),
  };
}

async function issueBoundRun(
  context: Omit<
    ServerBatchTaskContext,
    "remainingTargets" | "tailoringHandle"
  >,
) {
  const { input, job, profile, hashes } = context;
  return issueTailoringRun({
    userId: input.userId,
    issueKey: input.issueKey,
    jobId: job.id,
    resumeProfileId: profile.id,
    source: "SERVER_BATCH",
    delivery: "FINAL",
    requiredTargets: ["RESUME", "COVER"],
    ...hashes,
    batch: {
      batchId: input.batchId,
      taskId: input.taskId,
      executionAttemptId: input.executionAttemptId,
    },
    promptReceipts: {},
  });
}

function remainingTargetsFor(
  run: Awaited<ReturnType<typeof issueTailoringRun>>["run"],
): readonly BatchTarget[] {
  const progress = applicationBatchTargetProgress({
    requiredTargetMask: run.requiredTargetMask,
    acceptedTargetMask: run.acceptedTargetMask,
  });
  if (progress.remainingTargets.length > 0) {
    return [...progress.remainingTargets];
  }
  throw new AppError({
    code: "BATCH_TARGET_PROGRESS_STALE",
    status: 409,
    publicMessage: "The batch task has no remaining document targets.",
  });
}

async function startBoundRun(
  input: ExecuteServerBatchTailoringTaskInput,
  runId: string,
): Promise<TailoringRunHandle> {
  const started = await startTailoringRun({
    userId: input.userId,
    runId,
    attemptId: input.executionAttemptId,
    batchExecutionAttemptId: input.executionAttemptId,
  });
  return started.handle;
}

async function prepareTaskContext(
  input: ExecuteServerBatchTailoringTaskInput,
): Promise<ServerBatchTaskContext> {
  const job = await requireJob(input);
  const profileLocale = marketStringToResumeLocale(job.market);
  const profile = await requireProfile(input.userId, profileLocale);
  const hashes = snapshotHashes(job, profile);
  const partial = { input, job, profile, profileLocale, hashes };
  const issued = await issueBoundRun(partial);
  return {
    ...partial,
    remainingTargets: remainingTargetsFor(issued.run),
    tailoringHandle: await startBoundRun(input, issued.run.id),
  };
}

async function readExpectedHash(
  input: ExecuteServerBatchTailoringTaskInput,
): Promise<string | null> {
  const application = await prisma.application.findUnique({
    where: {
      userId_jobId: { userId: input.userId, jobId: input.jobId },
    },
    select: { aiContentHash: true },
  });
  return application?.aiContentHash ?? null;
}

async function generateResume(
  context: ServerBatchTaskContext,
): Promise<ResumeGeneration> {
  return buildResumePdfForJob({
    userId: context.input.userId,
    profile: context.profile,
    job: context.job,
    tailorOptions: {
      targets: context.remainingTargets.map((target) =>
        target === "RESUME" ? "resume" : "cover",
      ),
      strictCoverQuality: true,
      maxCoverRewritePasses: 2,
      maxReviewerPasses: 1,
      requireIndependentReview: true,
      requireQualityPass: true,
      localeProfile: context.profileLocale,
      targetWordRange: getLocaleProfile(context.profileLocale).coverWordRange,
    },
  });
}

function mergeCoverProposal(
  context: ServerBatchTaskContext,
  resume: ResumeGeneration,
): AiContent {
  if (!context.remainingTargets.includes("COVER")) return resume.aiContent;
  const acceptance = acceptApplicationGeneration({
    evidenceScopeKey: context.input.userId,
    target: "cover",
    source: "server_batch",
    rawOutput: JSON.stringify({ cover: resume.tailored.cover }),
    promptMetaHash: resume.tailored.promptMetaHash.cover,
    master: resume.renderInput,
    profile: context.profile,
    job: context.job,
  });
  if (!acceptance.ok) {
    throw new Error(
      `INTERNAL_COVER_GENERATION_INVALID:${acceptance.error.code}`,
    );
  }
  const aggregate = evolveApplicationAiContent({
    current: resume.aiContent,
    command: {
      kind: "replace_target_proposal",
      target: "cover",
      proposal: acceptance.aiContent,
    },
    reviewContext: reviewContext(context, resume),
  });
  if (aggregate.kind !== "evolved") {
    throw new Error("APPLICATION_REVIEW_CONTEXT_REQUIRED");
  }
  return aggregate.aiContent;
}

function reviewContext(
  context: ServerBatchTaskContext,
  resume: ResumeGeneration,
) {
  return {
    scopeKey: context.input.userId,
    resumeSnapshot: {
      profile: context.profile,
      renderInput: resume.renderInput,
    },
    jobDescription: context.job.description,
    jobSourceAvailable: true,
  } as const;
}

function requiredKeywords(aiContent: AiContent): string[] {
  return (aiContent.review?.requirements ?? [])
    .flatMap((item) => item.text.split(/[\s,/|():;-]+/))
    .filter((item) => item.length >= 3)
    .slice(0, 30);
}

async function validateResume(
  context: ServerBatchTaskContext,
  resume: ResumeGeneration,
  keywords: readonly string[],
): Promise<AtsValidation | null> {
  if (!context.remainingTargets.includes("RESUME")) return null;
  if (!resume.pdf) throw new Error("RESUME_RENDER_MISSING");
  return assertAtsPdf(resume.pdf, {
    maxPages: 2,
    minTextChars: 180,
    requiredKeywords: [...keywords],
  });
}

async function renderCover(
  context: ServerBatchTaskContext,
  resume: ResumeGeneration,
  aiContent: AiContent,
): Promise<Buffer | null> {
  if (!context.remainingTargets.includes("COVER")) return null;
  const [paragraphOne, paragraphTwo, paragraphThree] = coverParagraphTexts(
    aiContent.cover,
  );
  return compileLatexToPdf(
    renderCoverLetterTex({
      candidate: {
        name: resume.renderInput.candidate.name,
        title: resume.renderInput.candidate.title,
        phone: resume.renderInput.candidate.phone,
        email: resume.renderInput.candidate.email,
        linkedinUrl: resume.renderInput.candidate.linkedinUrl,
        linkedinText: resume.renderInput.candidate.linkedinText,
      },
      company: context.job.company || "the company",
      role: context.job.title,
      paragraphOne,
      paragraphTwo,
      paragraphThree,
    }),
  );
}

async function validateCover(
  coverPdf: Buffer | null,
  keywords: readonly string[],
): Promise<AtsValidation | null> {
  if (!coverPdf) return null;
  return assertAtsPdf(coverPdf, {
    maxPages: 2,
    minTextChars: 160,
    requiredKeywords: [...keywords],
  });
}

function pdfNames(
  context: ServerBatchTaskContext,
): Pick<GeneratedDocuments, "resumePdfName" | "coverPdfName"> {
  const name = resumeFilenameSegments(context.profile).name;
  return {
    resumePdfName: buildPdfFilename(name, context.job.title),
    coverPdfName: buildPdfFilename(name, context.job.title, "cl"),
  };
}

async function generateDocuments(
  context: ServerBatchTaskContext,
): Promise<GeneratedDocuments> {
  const resume = await generateResume(context);
  const aiContent = mergeCoverProposal(context, resume);
  if (aiContent.review?.verdict === "blocked") {
    throw new Error("APPLICATION_REVIEW_BLOCKED");
  }
  const keywords = requiredKeywords(aiContent);
  const resumeAtsValidation = await validateResume(
    context,
    resume,
    keywords,
  );
  const coverPdf = await renderCover(context, resume, aiContent);
  return {
    resume,
    aiContent,
    coverPdf,
    resumeAtsValidation,
    coverAtsValidation: await validateCover(coverPdf, keywords),
    ...pdfNames(context),
  };
}

function promptHashFor(
  resume: ResumeGeneration,
  target: BatchTarget,
): string {
  return target === "RESUME"
    ? resume.tailored.promptMetaHash.resume
    : resume.tailored.promptMetaHash.cover;
}

async function bindPromptReceipts(
  context: ServerBatchTaskContext,
  resume: ResumeGeneration,
): Promise<void> {
  for (const target of context.remainingTargets) {
    const promptHash = promptHashFor(resume, target);
    await bindTailoringRunPrompt({
      userId: context.input.userId,
      runId: context.tailoringHandle.id,
      target,
      receipt: { promptHash, promptMetaHash: promptHash },
      batchExecutionAttemptId: context.input.executionAttemptId,
    });
  }
}

function tailoringAcceptances(
  context: ServerBatchTaskContext,
  documents: GeneratedDocuments,
): readonly TailoringAcceptanceRequest[] {
  return context.remainingTargets.map((target) => {
    const promptHash = promptHashFor(documents.resume, target);
    return {
      handle: context.tailoringHandle,
      source: "SERVER_BATCH",
      delivery: "FINAL",
      target,
      requestHash: hashTailoringRunValue({
        protocol: "tailoring-run/v1",
        delivery: "FINAL",
        promptHash,
        payload: acceptedTargetPayload(documents.aiContent, target),
      }),
      promptHash,
      ...context.hashes,
      batchExecutionAttemptId: context.input.executionAttemptId,
    };
  });
}

function commitArtifacts(
  context: ServerBatchTaskContext,
  documents: GeneratedDocuments,
): CommitArtifact[] {
  const artifacts: CommitArtifact[] = [];
  if (context.remainingTargets.includes("RESUME") && documents.resume.pdf) {
    artifacts.push({
      target: "resume",
      pdf: documents.resume.pdf,
      filename: documents.resumePdfName,
      atsValidation: documents.resumeAtsValidation,
    });
  }
  if (context.remainingTargets.includes("COVER") && documents.coverPdf) {
    artifacts.push({
      target: "cover",
      pdf: documents.coverPdf,
      atsValidation: documents.coverAtsValidation,
    });
  }
  return artifacts;
}

function commitInput(
  context: ServerBatchTaskContext,
  documents: GeneratedDocuments,
  expectedHash: string | null,
): Parameters<typeof commitApplicationArtifact>[0] {
  const base = {
    userId: context.input.userId,
    job: {
      id: context.job.id,
      title: context.job.title,
      company: context.job.company,
    },
    resumeProfileId: context.profile.id,
    aiContent: documents.aiContent,
    expectedHash,
    publicationRenderContext: buildApplicationPublicationRenderContext({
      profile: context.profile,
      job: context.job,
    }),
    artifacts: commitArtifacts(context, documents),
    status: "FINAL" as const,
    extraData: {
      reviewReport: {
        deterministic: documents.aiContent.review ?? null,
        independent: documents.resume.tailored.reviewer ?? null,
        quality: documents.resume.tailored.qualityReport ?? null,
      },
    },
    tailoring: tailoringAcceptances(context, documents),
  };
  if (context.remainingTargets.length !== 1) return base;
  return {
    ...base,
    mergeTarget:
      context.remainingTargets[0] === "RESUME" ? "resume" : "cover",
    reviewContext: reviewContext(context, documents.resume),
  };
}

function commitFailure(result: Exclude<CommitResult, { kind: "committed" }>) {
  if (result.kind === "job_missing") {
    return new AppError({
      code: "JOB_NOT_FOUND",
      status: 404,
      publicMessage: "Job not found.",
    });
  }
  if (result.kind === "stale_render_context") {
    return new AppError({
      code: "STALE_RENDER_CONTEXT",
      status: 409,
      publicMessage:
        "The resume profile or job changed while the PDF was rendering. Generate it again.",
    });
  }
  if (result.kind === "stale_write") {
    return new AppError({
      code: "APPLICATION_CONTENT_CHANGED",
      status: 409,
      publicMessage:
        "The application changed while the documents were generating. Generate them again.",
    });
  }
  return remainingCommitFailure(result);
}

function remainingCommitFailure(
  result: Exclude<
    CommitResult,
    { kind: "committed" | "job_missing" | "stale_render_context" | "stale_write" }
  >,
): AppError {
  if (result.kind === "review_blocked") {
    return new AppError({
      code: "APPLICATION_REVIEW_BLOCKED",
      status: 422,
      publicMessage:
        "The draft contains claims that are not grounded in the master resume.",
      publicDetails: result.review,
    });
  }
  if (result.kind === "blob_not_configured") {
    return new AppError({
      code: APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.code,
      status: APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.status,
      publicMessage: APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.message,
    });
  }
  return new AppError({
    code: "APPLICATION_PERSIST_FAILED",
    status: 500,
    publicMessage: "The application could not be saved.",
    privateDetails: result.kind === "upload_failed" ? result.cause : result.kind,
  });
}

function requireCommitted(
  result: CommitResult,
): Extract<CommitResult, { kind: "committed" }> {
  if (result.kind === "committed") return result;
  throw commitFailure(result);
}

function taskResult(
  context: ServerBatchTaskContext,
  documents: GeneratedDocuments,
  commit: Extract<CommitResult, { kind: "committed" }>,
): ServerBatchTailoringTaskResult {
  return {
    applicationId: commit.applicationId,
    jobId: context.job.id,
    resumePdfUrl: commit.urls.resume ?? null,
    resumePdfName: documents.resumePdfName,
    coverPdfUrl: commit.urls.cover ?? null,
    coverPdfName: documents.coverPdfName,
  };
}

async function executeOwnedTask(
  context: ServerBatchTaskContext,
): Promise<ServerBatchTailoringTaskResult> {
  const expectedHash = await readExpectedHash(context.input);
  const documents = await generateDocuments(context);
  await bindPromptReceipts(context, documents.resume);
  const commit = requireCommitted(
    await commitApplicationArtifact(
      commitInput(context, documents, expectedHash),
    ),
  );
  return taskResult(context, documents, commit);
}

async function failOwnedRun(context: ServerBatchTaskContext): Promise<void> {
  await failTailoringRun({
    userId: context.input.userId,
    handle: context.tailoringHandle,
    errorCode: "SERVER_BATCH_FAILED",
    errorMessage: "Server batch generation failed",
    batchExecutionAttemptId: context.input.executionAttemptId,
  }).catch(() => undefined);
}

/**
 * Execute one claimed server-batch task through the durable TailoringRun
 * protocol. Batch identity is mandatory; no server generation commits without
 * a run, target receipts, and an Application content-hash compare-and-swap.
 */
export async function executeServerBatchTailoringTask(
  input: ExecuteServerBatchTailoringTaskInput,
): Promise<ServerBatchTailoringTaskResult> {
  const context = await prepareTaskContext(input);
  try {
    return await executeOwnedTask(context);
  } catch (error) {
    await failOwnedRun(context);
    throw error;
  }
}
