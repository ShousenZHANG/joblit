import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { del, put } from "@vercel/blob";
import { errorJson, notFoundError, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { toErrorResponse } from "@/lib/server/api/appError";
import { enforceAiRateLimit } from "@/lib/server/api/aiRateLimit";
import { buildPromptMeta, validatePromptMetaForImport } from "@/lib/server/ai/promptContract";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { LatexRenderError, compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { contentDispositionAttachment } from "@/lib/server/files/pdfFilename";
import {
  assertAtsPdf,
  AtsPdfValidationError,
  type AtsPdfValidation,
} from "@/lib/server/applications/atsPdfValidator";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildManualImportArtifact } from "@/lib/server/applications/manualImportArtifact";
import {
  ImportedPromptMetaSchema,
  ManualGenerateSchema,
} from "@/lib/server/applications/manualImportParser";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { mergeAiContentForTarget } from "@/lib/server/applications/mergeAiContentForTarget";
import { reportError } from "@/lib/server/observability/errorReporter";
import { persistReviewLedger } from "@/lib/server/applications/persistReviewLedger";
import {
  aiContentSchema,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

export const runtime = "nodejs";

/**
 * `?finalize` query flag (see ADR-0002):
 *   true  (default)  Atomic: render PDF + commit Application status=FINAL.
 *                     Codex Batch and any non-interactive caller path.
 *   false             Persist aiContent + status=DRAFT, skip PDF render,
 *                     return JSON { applicationId, status, aiContentHash }
 *                     so the client can navigate to /jobs/[id]/tailor.
 */
function parseFinalizeFlag(req: Request): boolean {
  const url = new URL(req.url);
  const v = url.searchParams.get("finalize");
  if (v === null) return true;
  return v !== "false" && v !== "0";
}

type ApplicationJob = {
  id: string;
  title: string;
  company: string | null;
};

async function commitGeneratedApplication(input: {
  userId: string;
  job: ApplicationJob;
  resumeProfileId: string;
  incomingAiContent: AiContent;
  target: "resume" | "cover";
  status: "DRAFT" | "FINAL";
  pdfUrl: string | null;
  pdfName: string | null;
  atsValidation?: AtsPdfValidation | null;
}) {
  return prisma.$transaction(async (tx) => {
    // The lock is intentionally first. Concurrent CV and cover imports for
    // the same job then re-read and merge against the preceding commit rather
    // than both overwriting from one stale snapshot.
    await acquireApplicationMutationLock(tx, input.userId, input.job.id);
    const existing = await tx.application.findUnique({
      where: {
        userId_jobId: { userId: input.userId, jobId: input.job.id },
      },
      select: {
        resumePdfUrl: true,
        coverPdfUrl: true,
        aiContent: true,
        atsValidation: true,
      },
    });
    const existingAiContent = aiContentSchema.safeParse(existing?.aiContent);
    const mergedAiContent = mergeAiContentForTarget(
      existingAiContent.success ? existingAiContent.data : null,
      input.incomingAiContent,
      input.target,
    );
    const aiContentHash = hashAiContent(mergedAiContent);
    const artifactPatch =
      input.status !== "FINAL"
        ? {}
        : input.target === "resume"
          ? {
              // Never leave an older PDF attached to newly committed content.
              resumePdfUrl: input.pdfUrl,
              resumePdfName: input.pdfUrl ? input.pdfName : null,
            }
          : {
              coverPdfUrl: input.pdfUrl,
            };
    const existingAtsValidation =
      existing?.atsValidation &&
      typeof existing.atsValidation === "object" &&
      !Array.isArray(existing.atsValidation)
        ? existing.atsValidation
        : {};
    const atsValidation = {
      ...existingAtsValidation,
      [input.target]: input.atsValidation ?? null,
    };

    const application = await tx.application.upsert({
      where: {
        userId_jobId: { userId: input.userId, jobId: input.job.id },
      },
      create: {
        userId: input.userId,
        jobId: input.job.id,
        resumeProfileId: input.resumeProfileId,
        company: input.job.company,
        role: input.job.title,
        status: input.status,
        aiContent: mergedAiContent,
        aiContentHash,
        atsValidation,
        reviewReport: mergedAiContent.review ?? undefined,
        ...artifactPatch,
      },
      update: {
        resumeProfileId: input.resumeProfileId,
        company: input.job.company,
        role: input.job.title,
        status: input.status,
        aiContent: mergedAiContent,
        aiContentHash,
        atsValidation,
        reviewReport: mergedAiContent.review ?? undefined,
        ...artifactPatch,
      },
      select: { id: true },
    });
    await persistReviewLedger(tx, {
      userId: input.userId,
      applicationId: application.id,
      jobId: input.job.id,
      aiContent: mergedAiContent,
    });

    return {
      applicationId: application.id,
      aiContent: mergedAiContent,
      aiContentHash,
      previousArtifactUrl:
        input.target === "resume"
          ? existing?.resumePdfUrl ?? null
          : existing?.coverPdfUrl ?? null,
    };
  });
}

export async function POST(req: Request) {
  const finalize = parseFinalizeFlag(req);
  return withSessionRoute(async ({ userId, requestId }) => {
    const limited = enforceAiRateLimit(userId, requestId);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const parsed = ManualGenerateSchema.safeParse(body);
    if (!parsed.success) {
      const localAiOutputTooLarge =
        body &&
        typeof body === "object" &&
        (body as { source?: unknown }).source === "local_ai" &&
        parsed.error.issues.some(
          (issue) => issue.path.join(".") === "modelOutput" && issue.code === "too_big",
        );
      if (localAiOutputTooLarge) {
        return errorJson(
          "INVALID_AI_RESULT",
          "Local AI output exceeds the 80,000 character limit.",
          400,
          { requestId },
        );
      }
      return validationError(parsed.error, requestId);
    }
    const data = parsed.data;

  const job = await prisma.job.findFirst({
    where: { id: data.jobId, userId },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      description: true,
      market: true,
    },
  });

  if (!job) {
    return notFoundError("job", requestId);
  }

  const profileLocale = marketStringToResumeLocale(job.market);
  const profile = await getResumeProfile(userId, { locale: profileLocale });
  if (!profile) {
    return NextResponse.json(
      {
        error: {
          code: "NO_PROFILE",
          message: "Create and save your master resume before importing AI content.",
        },
        requestId,
      },
      { status: 404 },
    );
  }

  const activeRules = await getActivePromptSkillRulesForUser(userId);
  const expectedPromptMeta = buildPromptMeta({
    target: data.target,
    ruleSetId: activeRules.id,
    resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
  });

  if (data.promptMeta) {
    const importedPromptMeta = ImportedPromptMetaSchema.safeParse(data.promptMeta);
    if (!importedPromptMeta.success) {
      return validationError(importedPromptMeta.error, requestId);
    }
    const promptMetaValidation = validatePromptMetaForImport({
      expected: expectedPromptMeta,
      received: importedPromptMeta.data,
    });

    if (!promptMetaValidation.ok) {
      return errorJson(
        "PROMPT_META_MISMATCH",
        "Prompt/skill pack is out of date. Re-download skill pack and copy a fresh prompt for this job.",
        409,
        { details: promptMetaValidation, requestId },
      );
    }
  }

  const renderInput = mapResumeProfile(profile);

  // Build the artifact regardless of finalize mode — even DRAFT mode
  // needs the aiContent provenance extracted from the AI output JSON.
  const artifact = buildManualImportArtifact({
    evidenceScopeKey: userId,
    target: data.target,
    modelOutput: data.modelOutput,
    mode: data.source === "local_ai" ? "strict" : "legacy",
    source: data.source,
    promptMetaHash: expectedPromptMeta.promptHash,
    renderInput,
    profile,
    job,
  });
  if (!artifact.ok) {
    return errorJson(
      artifact.error.code,
      artifact.error.message,
      artifact.error.status,
      { details: artifact.error.details, requestId },
    );
  }

  if (finalize && artifact.aiContent.review?.verdict === "blocked") {
    return errorJson(
      "APPLICATION_REVIEW_BLOCKED",
      "The draft contains claims that are not grounded in the master resume.",
      422,
      { details: artifact.aiContent.review, requestId },
    );
  }

  // DRAFT mode: skip PDF compile + Blob upload. Just persist the
  // aiContent snapshot and return JSON. Caller navigates to
  // /jobs/[id]/tailor to review.
  if (!finalize) {
    const committed = await commitGeneratedApplication({
      userId,
      job,
      resumeProfileId: profile.id,
      incomingAiContent: artifact.aiContent,
      target: data.target,
      status: "DRAFT",
      pdfUrl: null,
      pdfName: null,
      atsValidation: null,
    });
    return NextResponse.json(
      {
        applicationId: committed.applicationId,
        status: "DRAFT",
        aiContentHash: committed.aiContentHash,
        aiContent: committed.aiContent,
        // DRAFT mode uploads nothing, so the review dialog's preview is an
        // opaque object URL. Hand it the canonical name the artifact builder
        // already computed rather than letting the browser invent one.
        pdfName: artifact.filename,
        coverQualityGate: artifact.coverQualityGate,
        coverQualityIssueCount: artifact.coverQualityIssueCount,
        job: {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
        },
        requestId,
      },
      { status: 200 },
    );
  }

  // FINAL mode: today's atomic behavior — render PDF + commit FINAL.
  let pdf: Buffer;
  let filename: string;
  let coverQualityGate = "pass";
  let coverQualityIssueCount = 0;
  let atsValidation: AtsPdfValidation;
  try {
    pdf = await compileLatexToPdf(artifact.tex);
    atsValidation = await assertAtsPdf(pdf, {
      maxPages: 2,
      minTextChars: data.target === "resume" ? 180 : 160,
      requiredKeywords: (artifact.aiContent.review?.requirements ?? [])
        .flatMap((item) => item.text.split(/[\s,/|():;-]+/))
        .filter((item) => item.length >= 3)
        .slice(0, 30),
    });
    filename = artifact.filename;
    coverQualityGate = artifact.coverQualityGate;
    coverQualityIssueCount = artifact.coverQualityIssueCount;
  } catch (err) {
    // `toErrorResponse` reports a LatexRenderError's upstream body rather than
    // returning it — that body can carry internal hostnames. The ATS report is
    // ours and is returned as publicDetails.
    const typed = toErrorResponse(err, requestId);
    if (typed) return typed;
    return NextResponse.json(
      { error: { code: "UNKNOWN_ERROR", message: "Unknown render error" }, requestId },
      { status: 500 },
    );
  }

  let persistedResumePdfUrl: string | null = null;
  let persistedCoverPdfUrl: string | null = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const artifactVersion = `${hashAiContent(artifact.aiContent)}-${randomUUID()}`;
      const blob = await put(
        buildApplicationArtifactBlobPath({
          userId,
          jobId: job.id,
          target: data.target,
          version: artifactVersion,
        }),
        pdf,
        {
          access: "public",
          contentType: "application/pdf",
          token: process.env.BLOB_READ_WRITE_TOKEN,
          ...APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
        },
      );
      if (data.target === "resume") {
        persistedResumePdfUrl = blob.url;
      } else {
        persistedCoverPdfUrl = blob.url;
      }
    } catch (error) {
      // The caller still receives the compiled PDF, but the DB commit below
      // clears the target's previous URL rather than mislabelling it as the
      // artifact for this new content.
      reportError(error, {
        scope: "applications.manual-generate.blob-upload",
        userId,
        tags: { jobId: job.id, target: data.target },
      });
    }
  }

  const currentArtifactUrl =
    data.target === "resume" ? persistedResumePdfUrl : persistedCoverPdfUrl;
  let committed: Awaited<ReturnType<typeof commitGeneratedApplication>>;
  try {
    committed = await commitGeneratedApplication({
      userId,
      job,
      resumeProfileId: profile.id,
      incomingAiContent: artifact.aiContent,
      target: data.target,
      status: "FINAL",
      pdfUrl: currentArtifactUrl,
      pdfName: filename,
      atsValidation,
    });
  } catch (error) {
    if (process.env.BLOB_READ_WRITE_TOKEN && currentArtifactUrl) {
      await del(currentArtifactUrl, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }).catch(() => undefined);
    }
    reportError(error, {
      scope: "applications.manual-generate.commit",
      userId,
      tags: { jobId: job.id, target: data.target },
    });
    return errorJson(
      "APPLICATION_PERSIST_FAILED",
      "The PDF was rendered but could not be saved. Please try again.",
      500,
      { requestId },
    );
  }

  if (
    process.env.BLOB_READ_WRITE_TOKEN &&
    committed.previousArtifactUrl &&
    committed.previousArtifactUrl !== currentArtifactUrl
  ) {
    await del(committed.previousArtifactUrl, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    }).catch(() => undefined);
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDispositionAttachment(filename),
      "x-application-id": committed.applicationId,
      "x-request-id": requestId,
      "x-tailor-cv-source": data.target === "resume" ? data.source : "base",
      "x-tailor-cover-source": data.target === "cover" ? data.source : "fallback",
      "x-tailor-reason": `${data.source}_ok`,
      "x-cover-quality-gate": coverQualityGate,
      "x-cover-quality-issue-count": String(coverQualityIssueCount),
    },
  });
  });
}
