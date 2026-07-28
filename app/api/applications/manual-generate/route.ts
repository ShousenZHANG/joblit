import { NextResponse } from "next/server";
import { errorJson, notFoundError, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE,
  commitApplicationArtifact,
} from "@/lib/server/applications/commitApplicationArtifact";
import { toErrorResponse } from "@/lib/server/api/appError";
import { enforceAiRateLimit } from "@/lib/server/api/aiRateLimit";
import { validatePromptMetaForImport } from "@/lib/server/ai/promptContract";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { contentDispositionAttachment } from "@/lib/server/files/pdfFilename";
import {
  assertAtsPdf,
  type AtsPdfValidation,
} from "@/lib/server/applications/atsPdfValidator";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildManualImportArtifact } from "@/lib/server/applications/manualImportArtifact";
import {
  ApplicationPromptError,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";
import {
  ImportedPromptMetaSchema,
  ManualGenerateSchema,
} from "@/lib/server/applications/manualImportParser";
import { reportError } from "@/lib/server/observability/errorReporter";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";
import {
  buildApplicationPublicationRenderContext,
  projectApplicationPublication,
  UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT,
} from "@/lib/server/applications/applicationPublication";
import {
  hashManualTailoringAcceptance,
  probeTailoringRunAcceptanceReplay,
} from "@/lib/server/tailoringRuns/tailoringRunAcceptance";
import {
  TailoringRunError,
  type TailoringRunDelivery,
  type TailoringRunSource,
  type TailoringRunTarget,
} from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import type { TailoringAcceptanceRequest } from "@/lib/server/tailoringRuns/tailoringRunTypes";

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

function requiresAuthoritativeReceipt(source: string): boolean {
  return source !== "manual_import";
}

function requiresTailoringRun(source: string): boolean {
  // Codex Batch is a coordinated server contract and has no legacy client
  // population. Local AI keeps an additive compatibility reader for extension
  // versions that predate TailoringRun handles.
  return source === "codex_batch";
}

function generationSourceLabel(source: string): string {
  return source === "local_ai" ? "Local AI" : "Codex Batch";
}

function protocolSource(source: string): TailoringRunSource {
  if (source === "local_ai") return "LOCAL_AI";
  if (source === "codex_batch") return "CODEX_BATCH";
  return "MANUAL_IMPORT";
}

function protocolTarget(target: "resume" | "cover"): TailoringRunTarget {
  return target === "resume" ? "RESUME" : "COVER";
}

export async function POST(req: Request) {
  const finalize = parseFinalizeFlag(req);
  return withSessionRoute(async ({ userId, requestId }) => {
    const body = await req.json().catch(() => null);
    const parsed = ManualGenerateSchema.safeParse(body);
    if (!parsed.success) {
      const strictOutputTooLarge =
        body &&
        typeof body === "object" &&
        requiresAuthoritativeReceipt(
          String((body as { source?: unknown }).source ?? "manual_import"),
        ) &&
        parsed.error.issues.some(
          (issue) => issue.path.join(".") === "modelOutput" && issue.code === "too_big",
        );
      if (strictOutputTooLarge) {
        const source = String(
          (body as { source?: unknown }).source ?? "manual_import",
        );
        return errorJson(
          "INVALID_AI_RESULT",
          `${generationSourceLabel(source)} output exceeds the 80,000 character limit.`,
          400,
          { requestId },
        );
      }
      return validationError(parsed.error, requestId);
    }
    const data = parsed.data;

  if (requiresAuthoritativeReceipt(data.source) && !data.promptMeta) {
    return errorJson(
      "PROMPT_META_REQUIRED",
      `${generationSourceLabel(data.source)} output must include the generation receipt. Run the current prompt again.`,
      400,
      { requestId },
    );
  }
  if (data.tailoringRun && !data.promptMeta) {
    return errorJson(
      "PROMPT_META_REQUIRED",
      "A TailoringRun import must include the prompt receipt issued with that run.",
      400,
      { requestId },
    );
  }
  const importedPromptMeta = data.promptMeta
    ? ImportedPromptMetaSchema.safeParse(data.promptMeta)
    : null;
  if (importedPromptMeta && !importedPromptMeta.success) {
    return validationError(importedPromptMeta.error, requestId);
  }
  if (
    importedPromptMeta?.success &&
    requiresAuthoritativeReceipt(data.source) &&
    (!importedPromptMeta.data.promptTemplateVersion ||
      !importedPromptMeta.data.schemaVersion ||
      !importedPromptMeta.data.skillPackVersion ||
      !importedPromptMeta.data.promptHash)
  ) {
    return errorJson(
      "PROMPT_META_REQUIRED",
      `${generationSourceLabel(data.source)} output must include the complete generation receipt. Run the current prompt again.`,
      400,
      { requestId },
    );
  }

  const delivery: TailoringRunDelivery = finalize ? "FINAL" : "DRAFT";
  const target = protocolTarget(data.target);
  const receivedPromptHash =
    importedPromptMeta?.success && importedPromptMeta.data.promptHash
      ? importedPromptMeta.data.promptHash
      : null;

  // Exact receipt replay must not depend on today's prompt rules, resume
  // snapshot, renderer, or Blob service. The immutable receipt is probed
  // before any of those adapters run.
  if (data.tailoringRun && receivedPromptHash) {
    let replay;
    try {
      replay = await prisma.$transaction((tx) =>
        probeTailoringRunAcceptanceReplay(
          tx as unknown as Parameters<
            typeof probeTailoringRunAcceptanceReplay
          >[0],
          {
            userId,
            jobId: data.jobId,
            request: {
              handle: data.tailoringRun!,
              source: protocolSource(data.source),
              delivery,
              target,
              requestHash: hashManualTailoringAcceptance({
                target,
                delivery,
                promptHash: receivedPromptHash,
                modelOutput: data.modelOutput,
              }),
              promptHash: receivedPromptHash,
            },
          },
        ),
      );
    } catch (error) {
      if (error instanceof TailoringRunError) {
        return errorJson(error.code, error.message, error.status, { requestId });
      }
      throw error;
    }

    if (replay) {
      const currentAiContent = aiContentSchema.safeParse(
        replay.application.aiContent,
      );
      if (!currentAiContent.success) {
        return errorJson(
          "AI_CONTENT_INVALID",
          "The accepted Application content is unavailable.",
          409,
          { requestId },
        );
      }
      const replayHeaders = {
        "x-application-id": replay.application.id,
        "x-request-id": requestId,
        "x-tailoring-replay": "exact",
        "x-tailoring-delivery": delivery,
      };
      const publication = projectApplicationPublication({
        aiContent: currentAiContent.data,
        record: {
          status: replay.application.status,
          aiContentHash: replay.application.aiContentHash,
          resumePdfUrl: replay.application.resumePdfUrl,
          coverPdfUrl: replay.application.coverPdfUrl,
          resumeContentHash: replay.application.resumeContentHash,
          coverContentHash: replay.application.coverContentHash,
          resumePublishedHash: replay.application.resumePublishedHash,
          coverPublishedHash: replay.application.coverPublishedHash,
        },
        renderContext: UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT,
      });
      if (!finalize) {
        return NextResponse.json(
          {
            applicationId: replay.application.id,
            status: publication.status,
            publication,
            aiContentHash: replay.application.aiContentHash,
            aiContent: currentAiContent.data,
            pdfName: replay.application.resumePdfName,
            job: replay.application.job,
            replayed: true,
            requestId,
          },
          { status: 200, headers: replayHeaders },
        );
      }
      return NextResponse.json(
        {
          applicationId: replay.application.id,
          status: publication.status,
          publication,
          aiContentHash: replay.application.aiContentHash,
          acceptedDelivery: "FINAL",
          target: data.target,
          replayed: true,
          requestId,
        },
        { status: 200, headers: replayHeaders },
      );
    }
  }

  const limited = enforceAiRateLimit(userId, requestId);
  if (limited) return limited;

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

  let promptMetaHash = "";
  let promptSnapshotBinding:
    | {
        resumeProfileId: string;
        resumeSnapshotHash: string;
        jobSnapshotHash: string;
      }
    | undefined;
  if (importedPromptMeta?.success) {
    let expectedPromptMeta;
    try {
      const prepared = await buildApplicationPromptForUser({
        userId,
        jobId: data.jobId,
        target: data.target,
        variant: data.source === "local_ai" ? "lean" : "full",
      });
      expectedPromptMeta = prepared.promptMeta;
      promptSnapshotBinding = prepared.snapshotBinding;
    } catch (error) {
      if (error instanceof ApplicationPromptError) {
        return errorJson(error.code, error.message, error.status, {
          details: error.details,
          requestId,
        });
      }
      throw error;
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
    // A partial legacy receipt can prove only the rule/profile epoch. It does
    // not prove which target, variant, job snapshot, or prompt bytes produced
    // the output, so never attribute it to the current exact prompt.
    if (importedPromptMeta.data.promptHash) {
      promptMetaHash = expectedPromptMeta.promptHash;
    }
  }

  const renderInput = mapResumeProfile(profile);
  const publicationRenderContext =
    buildApplicationPublicationRenderContext({
      profile,
      job: {
        title: job.title,
        company: job.company,
        market: job.market,
      },
    });

  // Build the artifact regardless of finalize mode — even DRAFT mode
  // needs the aiContent provenance extracted from the AI output JSON.
  const artifact = buildManualImportArtifact({
    evidenceScopeKey: userId,
    target: data.target,
    modelOutput: data.modelOutput,
    source: data.source,
    promptMetaHash,
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
  if (requiresTailoringRun(data.source) && !data.tailoringRun) {
    return errorJson(
      "TAILORING_RUN_REQUIRED",
      `${generationSourceLabel(data.source)} output must include its TailoringRun handle. Run the current prompt again.`,
      400,
      { requestId },
    );
  }

  // The grounding gate lives at the commit boundary, which reviews the merged
  // CV + Cover snapshot. There used to be a pre-emptive check here, reading a
  // review that acceptApplicationGeneration had built over ONE target with the
  // other half still empty — a different snapshot answering the same question.
  // commitApplicationArtifact returns review_blocked and the FINAL path already
  // handles it.
  const reviewContext = {
    scopeKey: userId,
    resumeSnapshot: { profile, renderInput },
    jobDescription: job.description,
    jobSourceAvailable: true,
  };
  const tailoringAcceptance: readonly TailoringAcceptanceRequest[] | undefined =
    data.tailoringRun && promptSnapshotBinding
      ? [
          {
            handle: data.tailoringRun,
            source: protocolSource(data.source),
            delivery,
            target,
            requestHash: hashManualTailoringAcceptance({
              target,
              delivery,
              promptHash: promptMetaHash,
              modelOutput: data.modelOutput,
            }),
            promptHash: promptMetaHash,
            resumeSnapshotHash: promptSnapshotBinding.resumeSnapshotHash,
            jobSnapshotHash: promptSnapshotBinding.jobSnapshotHash,
            ...(data.source === "codex_batch"
              ? { batchExecutionAttemptId: data.tailoringRun.attemptId }
              : {}),
          },
        ]
      : undefined;

  // DRAFT mode: skip PDF compile + Blob upload. Just persist the
  // aiContent snapshot and return JSON. Caller navigates to
  // /jobs/[id]/tailor to review.
  if (!finalize) {
    let committed;
    try {
      committed = await commitApplicationArtifact({
        userId,
        job,
        resumeProfileId: profile.id,
        aiContent: artifact.aiContent,
        publicationRenderContext,
        // A DRAFT renders nothing, so there is no artifact to upload — but the
        // target still selects which half of the AI Content the merge preserves.
        artifacts: [],
        status: "DRAFT",
        mergeTarget: data.target,
        reviewContext,
        ...(tailoringAcceptance ? { tailoring: tailoringAcceptance } : {}),
      });
    } catch (error) {
      if (error instanceof TailoringRunError) {
        return errorJson(error.code, error.message, error.status, { requestId });
      }
      throw error;
    }
    if (committed.kind === "invalid_ai_content") {
      return errorJson(
        "AI_CONTENT_INVALID",
        "The stored application content cannot be safely merged. Re-generate both targets.",
        409,
        { requestId },
      );
    }
    if (committed.kind !== "committed") {
      return errorJson("APPLICATION_PERSIST_FAILED", "Could not save the draft", 500, {
        requestId,
      });
    }
    return NextResponse.json(
      {
        applicationId: committed.applicationId,
        status: committed.publication.status,
        publication: committed.publication,
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
      publicationRenderContext,
      artifacts: [
        {
          target: data.target,
          pdf,
          filename,
          atsValidation,
          // The lifecycle module appends the PDF digest, keeping this
          // content-addressed without allowing different bytes to collide.
        },
      ],
      status: "FINAL",
      mergeTarget: data.target,
      reviewContext,
      ...(tailoringAcceptance ? { tailoring: tailoringAcceptance } : {}),
    });
    if (result.kind === "review_blocked") {
      return errorJson(
        "APPLICATION_REVIEW_BLOCKED",
        "The combined draft contains claims that are not grounded in the master resume.",
        422,
        { details: result.review, requestId },
      );
    }
    if (result.kind === "invalid_ai_content") {
      return errorJson(
        "AI_CONTENT_INVALID",
        "The stored application content cannot be safely merged. Re-generate both targets.",
        409,
        { requestId },
      );
    }
    if (result.kind === "stale_render_context") {
      return errorJson(
        "STALE_RENDER_CONTEXT",
        "Your resume profile or job changed while the PDF was rendering. Generate it again.",
        409,
        { requestId },
      );
    }
    if (result.kind === "blob_not_configured") {
      return errorJson(
        APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.code,
        APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.message,
        APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.status,
        { requestId },
      );
    }
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
    if (error instanceof TailoringRunError) {
      return errorJson(error.code, error.message, error.status, { requestId });
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
