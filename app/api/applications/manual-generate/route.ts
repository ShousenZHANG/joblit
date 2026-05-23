import { NextResponse } from "next/server";
import { del, put } from "@vercel/blob";
import { errorJson, notFoundError } from "@/lib/server/api/errorResponse";
import { parseJsonBody, withSessionRoute } from "@/lib/server/api/routeHandler";
import { enforceAiRateLimit } from "@/lib/server/api/aiRateLimit";
import { buildPromptMeta, validatePromptMetaForImport } from "@/lib/server/ai/promptContract";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { LatexRenderError, compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildManualImportArtifact } from "@/lib/server/applications/manualImportArtifact";
import { ManualGenerateSchema } from "@/lib/server/applications/manualImportParser";
import { hashAiContent } from "@/lib/shared/schemas/aiContent";

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

export async function POST(req: Request) {
  const finalize = parseFinalizeFlag(req);
  return withSessionRoute(async ({ userId, requestId }) => {
    const limited = enforceAiRateLimit(userId, requestId);
    if (limited) return limited;

    const parsed = await parseJsonBody(req, ManualGenerateSchema, requestId);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

  const job = await prisma.job.findFirst({
    where: { id: data.jobId, userId },
    select: { id: true, title: true, company: true, description: true, market: true },
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

  const existingApplication = await prisma.application.findUnique({
    where: { userId_jobId: { userId, jobId: job.id } },
    select: { resumePdfUrl: true, coverPdfUrl: true },
  });

  if (data.promptMeta) {
    const activeRules = await getActivePromptSkillRulesForUser(userId);
    const expectedPromptMeta = buildPromptMeta({
      target: data.target,
      ruleSetId: activeRules.id,
      resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
    });
    const promptMetaValidation = validatePromptMetaForImport({
      expected: expectedPromptMeta,
      received: data.promptMeta,
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
    target: data.target,
    modelOutput: data.modelOutput,
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

  // DRAFT mode: skip PDF compile + Blob upload. Just persist the
  // aiContent snapshot and return JSON. Caller navigates to
  // /jobs/[id]/tailor to review.
  if (!finalize) {
    const aiContentHash = hashAiContent(artifact.aiContent);
    const application = await prisma.application.upsert({
      where: { userId_jobId: { userId, jobId: job.id } },
      create: {
        userId,
        jobId: job.id,
        resumeProfileId: profile.id,
        company: job.company,
        role: job.title,
        status: "DRAFT",
        aiContent: artifact.aiContent,
        aiContentHash,
      },
      update: {
        resumeProfileId: profile.id,
        company: job.company,
        role: job.title,
        status: "DRAFT",
        aiContent: artifact.aiContent,
        aiContentHash,
      },
      select: { id: true },
    });
    return NextResponse.json(
      {
        applicationId: application.id,
        status: "DRAFT",
        aiContentHash,
        aiContent: artifact.aiContent,
        coverQualityGate: artifact.coverQualityGate,
        coverQualityIssueCount: artifact.coverQualityIssueCount,
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
  try {
    pdf = await compileLatexToPdf(artifact.tex);
    filename = artifact.filename;
    coverQualityGate = artifact.coverQualityGate;
    coverQualityIssueCount = artifact.coverQualityIssueCount;
  } catch (err) {
    if (err instanceof LatexRenderError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, details: err.details }, requestId },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: { code: "UNKNOWN_ERROR", message: "Unknown render error" }, requestId },
      { status: 500 },
    );
  }

  let persistedResumePdfUrl: string | null = null;
  let persistedCoverPdfUrl: string | null = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await put(
        buildApplicationArtifactBlobPath({ userId, jobId: job.id, target: data.target }),
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
    } catch {
      // Keep generation successful even if blob persistence fails.
    }
  }

  // FINAL mode also persists aiContent so the user can later re-edit a
  // committed Application without re-generating.
  const aiContentHashFinal = hashAiContent(artifact.aiContent);
  const application = await prisma.application.upsert({
    where: { userId_jobId: { userId, jobId: job.id } },
    create: {
      userId,
      jobId: job.id,
      resumeProfileId: profile.id,
      company: job.company,
      role: job.title,
      status: "FINAL",
      aiContent: artifact.aiContent,
      aiContentHash: aiContentHashFinal,
      ...(data.target === "resume" && persistedResumePdfUrl
        ? { resumePdfUrl: persistedResumePdfUrl, resumePdfName: filename }
        : {}),
      ...(data.target === "cover" && persistedCoverPdfUrl
        ? { coverPdfUrl: persistedCoverPdfUrl }
        : {}),
    },
    update: {
      resumeProfileId: profile.id,
      company: job.company,
      role: job.title,
      status: "FINAL",
      aiContent: artifact.aiContent,
      aiContentHash: aiContentHashFinal,
      ...(data.target === "resume" && persistedResumePdfUrl
        ? { resumePdfUrl: persistedResumePdfUrl, resumePdfName: filename }
        : {}),
      ...(data.target === "cover" && persistedCoverPdfUrl
        ? { coverPdfUrl: persistedCoverPdfUrl }
        : {}),
    },
    select: { id: true },
  });

  const previousArtifactUrl =
    data.target === "resume"
      ? existingApplication?.resumePdfUrl ?? null
      : existingApplication?.coverPdfUrl ?? null;
  const currentArtifactUrl =
    data.target === "resume" ? persistedResumePdfUrl : persistedCoverPdfUrl;
  if (
    process.env.BLOB_READ_WRITE_TOKEN &&
    previousArtifactUrl &&
    currentArtifactUrl &&
    previousArtifactUrl !== currentArtifactUrl
  ) {
    await del(previousArtifactUrl, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => undefined);
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-application-id": application.id,
      "x-request-id": requestId,
      "x-tailor-cv-source": data.target === "resume" ? "manual_import" : "base",
      "x-tailor-cover-source": data.target === "cover" ? "manual_import" : "fallback",
      "x-tailor-reason": "manual_import_ok",
      "x-cover-quality-gate": coverQualityGate,
      "x-cover-quality-issue-count": String(coverQualityIssueCount),
    },
  });
  });
}
