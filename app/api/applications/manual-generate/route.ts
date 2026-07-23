import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { errorJson, notFoundError, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { commitApplicationArtifact } from "@/lib/server/applications/commitApplicationArtifact";
import { toErrorResponse } from "@/lib/server/api/appError";
import { enforceAiRateLimit } from "@/lib/server/api/aiRateLimit";
import { buildPromptMeta, validatePromptMetaForImport } from "@/lib/server/ai/promptContract";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { contentDispositionAttachment } from "@/lib/server/files/pdfFilename";
import {
  assertAtsPdf,
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
import { reportError } from "@/lib/server/observability/errorReporter";
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
    const committed = await commitApplicationArtifact({
      userId,
      job,
      resumeProfileId: profile.id,
      aiContent: artifact.aiContent,
      // A DRAFT renders nothing, so there is no artifact to upload — but the
      // target still selects which half of the AI Content the merge preserves.
      artifacts: [],
      status: "DRAFT",
      mergeTarget: data.target,
    });
    if (committed.kind !== "committed") {
      return errorJson("APPLICATION_PERSIST_FAILED", "Could not save the draft", 500, {
        requestId,
      });
    }
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

  let committed;
  try {
    const result = await commitApplicationArtifact({
      userId,
      job,
      resumeProfileId: profile.id,
      aiContent: artifact.aiContent,
      artifacts: [
        {
          target: data.target,
          pdf,
          filename,
          atsValidation,
          version: `${hashAiContent(artifact.aiContent)}-${randomUUID()}`,
        },
      ],
      status: "FINAL",
      mergeTarget: data.target,
    });
    if (result.kind !== "committed") {
      // An upload failure used to be swallowed here, committing a null URL that
      // cleared the user's previous PDF. It is now a plain failure.
      if (result.kind === "upload_failed") {
        reportError(result.cause, {
          scope: "applications.manual-generate.blob-upload",
          userId,
          tags: { jobId: job.id, target: data.target },
        });
      }
      return errorJson(
        "APPLICATION_PERSIST_FAILED",
        "The PDF was rendered but could not be saved. Please try again.",
        500,
        { requestId },
      );
    }
    committed = result;
  } catch (error) {
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
