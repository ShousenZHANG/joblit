import { randomUUID } from "node:crypto";
import { Prisma, type LocalTailoringTask } from "@/lib/generated/prisma";
import { AppError } from "@/lib/server/api/appError";
import { buildManualImportArtifact } from "@/lib/server/applications/manualImportArtifact";
import { commitApplicationArtifact, type CommitResult } from "@/lib/server/applications/commitApplicationArtifact";
import { buildApplicationPublicationRenderContext } from "@/lib/server/applications/applicationPublication";
import { assertAtsPdf } from "@/lib/server/applications/atsPdfValidator";
import { buildAtsKeywords } from "@/lib/server/applications/finalizeApplication";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { compileLatexToPdf, LatexRenderError } from "@/lib/server/latex/compilePdf";
import { reportError } from "@/lib/server/observability/errorReporter";
import { digest } from "./capability";
import { ACTIVE_STATUSES, CLAIM_LIFETIME_MS, MAX_ATTEMPTS, type AttemptResult, type CompletedResult, type TaskAccess } from "./contract";
import { assertTaskSources } from "./sources";
import { assertTaskAccess, taskError, withTaskTransaction } from "./tasks";
import { APPLICATION_TARGET_SELECT, applicationTargetHash } from "./applicationTarget";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const publishing = (attempt: number): AttemptResult => ({ status: "publishing", attempt, retryAfterSeconds: 3 });

function assertActive(task: LocalTailoringTask) {
  if (!ACTIVE_STATUSES.includes(task.status)) throw taskError("LOCAL_TASK_NOT_ACTIVE", `This generation is ${task.status}.`);
  if (task.expiresAt.getTime() <= Date.now()) throw taskError("LOCAL_TASK_EXPIRED", "This generation authorization expired.", 410);
}

async function assertApplicationUnchanged(tx: Prisma.TransactionClient, task: LocalTailoringTask) {
  const application = await tx.application.findUnique({ where: { userId_jobId: { userId: task.userId, jobId: task.jobId } }, select: APPLICATION_TARGET_SELECT });
  if (applicationTargetHash(application, task.target) !== task.expectedTargetHash) {
    throw taskError("LOCAL_TASK_APPLICATION_CHANGED", "Your application changed after generation started. Your edits were kept. Start a new task.");
  }
}

async function claimResult(id: string, access: TaskAccess, input: { rawOutput: string; attempt: number }) {
  return withTaskTransaction(id, access, async (tx, task) => {
    const key = { taskId_attempt: { taskId: id, attempt: input.attempt } };
    const previous = await tx.localTailoringAttempt.findUnique({ where: key });
    if (previous && previous.outputHash !== digest(input.rawOutput)) throw taskError("LOCAL_TASK_RESULT_CONFLICT", "This attempt already has a different result.");
    if (task.status === "completed" && task.result) return { kind: "response" as const, response: task.result as unknown as AttemptResult };
    if (task.status === "failed" && previous?.response && (previous.response as { status?: string }).status === "failed") return { kind: "response" as const, response: previous.response as unknown as AttemptResult };
    assertActive(task);
    if (previous?.response) return { kind: "response" as const, response: previous.response as unknown as AttemptResult };
    if (previous?.claimExpiresAt && previous.claimExpiresAt.getTime() > Date.now()) return { kind: "response" as const, response: publishing(input.attempt) };
    if (!previous) {
      const predecessor = input.attempt > 1 ? await tx.localTailoringAttempt.findUnique({ where: { taskId_attempt: { taskId: id, attempt: input.attempt - 1 } } }) : null;
      const verdict = predecessor?.response as { status?: string } | null;
      if ((input.attempt > 1 && verdict?.status !== "repair") || input.attempt < task.attempt || input.attempt > task.attempt + 1) {
        throw taskError("LOCAL_TASK_ATTEMPT_CONFLICT", "Submit the task's current attempt before continuing.");
      }
    }
    const sources = await assertTaskSources(tx, task);
    await assertApplicationUnchanged(tx, task);
    const claimId = randomUUID();
    const data = { claimId, claimExpiresAt: new Date(Date.now() + CLAIM_LIFETIME_MS) };
    await tx.localTailoringAttempt.upsert({ where: key, create: { taskId: id, attempt: input.attempt, outputHash: digest(input.rawOutput), ...data }, update: data });
    await tx.localTailoringTask.update({ where: { id }, data: { status: "publishing", attempt: input.attempt, error: Prisma.DbNull } });
    return { kind: "claimed" as const, task, sources, claimId };
  });
}

async function assertClaim(tx: Prisma.TransactionClient, task: LocalTailoringTask, access: TaskAccess, attempt: number, claimId: string) {
  const current = await tx.localTailoringTask.findUnique({ where: { id: task.id } });
  assertTaskAccess(current, access);
  assertActive(current);
  const claim = await tx.localTailoringAttempt.findUnique({ where: { taskId_attempt: { taskId: task.id, attempt } } });
  if (claim?.claimId !== claimId || !claim.claimExpiresAt || claim.claimExpiresAt.getTime() <= Date.now()) {
    throw taskError("LOCAL_TASK_CLAIM_LOST", "Another request is handling this result. Check the task status.");
  }
  return current;
}

async function rejectAttempt(task: LocalTailoringTask, access: TaskAccess, attempt: number, claimId: string, error: { code: string; message: string }): Promise<AttemptResult> {
  return withTaskTransaction(task.id, access, async (tx) => {
    await assertClaim(tx, task, access, attempt, claimId);
    const previous = attempt > 1 ? await tx.localTailoringAttempt.findUnique({ where: { taskId_attempt: { taskId: task.id, attempt: attempt - 1 } } }) : null;
    const repeated = (previous?.response as { code?: string } | null)?.code === error.code;
    const status = attempt >= MAX_ATTEMPTS || repeated ? "failed" : "repair";
    const response: AttemptResult = {
      status, ...error, attempt, maxAttempts: MAX_ATTEMPTS,
      ...(status === "repair" ? { repairInstruction: `Your previous answer was rejected by a deterministic validator.\nRejection code: ${error.code}\nReason: ${error.message}\nReturn the full corrected JSON object only. No commentary or code fences.` } : {}),
    };
    await tx.localTailoringAttempt.update({ where: { taskId_attempt: { taskId: task.id, attempt } }, data: { response: json(response), claimId: null, claimExpiresAt: null } });
    await tx.localTailoringTask.update({ where: { id: task.id }, data: { status, error: json(error) } });
    return response;
  });
}

function committedResponse(result: Extract<CommitResult, { kind: "committed" }>, task: LocalTailoringTask, filename: string): CompletedResult {
  return {
    status: "completed", applicationId: result.applicationId, aiContentHash: result.aiContentHash, publication: result.publication,
    resumePdfUrl: result.urls.resume ?? null,
    resumePdfName: task.target === "resume" ? filename : null,
    coverPdfUrl: result.urls.cover ?? null,
    coverPdfName: task.target === "cover" ? filename : null,
  };
}

function commitFailure(result: Exclude<CommitResult, { kind: "committed" }>): AppError {
  switch (result.kind) {
    case "stale_write": return taskError("LOCAL_TASK_APPLICATION_CHANGED", "Your application changed. Your edits were kept.");
    case "stale_render_context": return taskError("LOCAL_TASK_SOURCE_CHANGED", "Your resume or job changed while publishing.");
    case "job_missing": return taskError("LOCAL_TASK_SOURCE_CHANGED", "This job is no longer available.");
    case "invalid_ai_content": return taskError("AI_CONTENT_INVALID", "Your stored application cannot safely be merged.");
    case "blob_not_configured": return taskError("ARTIFACT_STORAGE_UNAVAILABLE", "PDF storage is not configured. Retry publication later.", 503);
    case "upload_failed":
      reportError(result.cause, { scope: "local-tailoring.publish" });
      return taskError("APPLICATION_PERSIST_FAILED", "The PDF could not be stored. Retry this result.", 503);
  }
}

/** Recoverable failures never erase the accepted bytes on the companion or
 * force a second paid model run. A retry submits the identical attempt. */
async function settleFailure(id: string, access: TaskAccess, attempt: number, claimId: string | undefined, error: unknown) {
  return withTaskTransaction(id, access, async (tx, current) => {
    // A lost HTTP/DB response may hide a successful commit. Its durable receipt
    // wins over this catch and over any later user edits to the Application.
    if (current.status === "completed" && current.result) return current.result as unknown as CompletedResult;
    if (!ACTIVE_STATUSES.includes(current.status)) return null;
    if (claimId) {
      const claim = await tx.localTailoringAttempt.findUnique({ where: { taskId_attempt: { taskId: id, attempt } } });
      if (claim?.claimId !== claimId) return null;
      await tx.localTailoringAttempt.update({ where: { taskId_attempt: { taskId: id, attempt } }, data: { claimId: null, claimExpiresAt: null } });
    }
    const known = error instanceof AppError || error instanceof LatexRenderError;
    const deterministic = known && error.status < 500 && error.code !== "LOCAL_TASK_CLAIM_LOST";
    // Renderer details can contain upstream configuration or response bodies.
    // Persist only the same safe code/message/status exposed by the API boundary.
    const failure = known
      ? { code: error.code, message: error instanceof AppError ? error.publicMessage : error.message, status: error.status }
      : { code: "LOCAL_PUBLICATION_RETRY", message: "Publication was interrupted. Retry the same result." };
    await tx.localTailoringTask.update({ where: { id }, data: { ...(deterministic ? { status: "failed" } : {}), error: json(failure) } });
    return null;
  });
}

export async function submitLocalResult(id: string, access: TaskAccess, input: { rawOutput: string; attempt: number }): Promise<AttemptResult> {
  let claimId: string | undefined;
  try {
    const claim = await claimResult(id, access, input);
    if (claim.kind === "response") return claim.response;
    claimId = claim.claimId;
    const { task, sources } = claim;
    const target = task.target === "cover" ? "cover" : "resume";
    const artifact = buildManualImportArtifact({ target, modelOutput: input.rawOutput, source: "local_ai", promptMetaHash: task.promptHash, renderInput: mapResumeProfile(sources.profile), profile: sources.profile, job: sources.job });
    if (!artifact.ok) return rejectAttempt(task, access, input.attempt, claim.claimId, artifact.error);
    const pdf = await compileLatexToPdf(artifact.tex, { engine: sources.locale === "zh-CN" ? "xelatex" : "pdflatex" });
    const atsValidation = await assertAtsPdf(pdf, { maxPages: 2, minTextChars: target === "resume" ? 180 : 160, requiredKeywords: buildAtsKeywords(sources.job.title) });
    const committed = await commitApplicationArtifact({
      userId: task.userId, job: sources.job, resumeProfileId: sources.profile.id,
      aiContent: artifact.aiContent, publicationRenderContext: buildApplicationPublicationRenderContext(sources),
      artifacts: [{ target, pdf, filename: artifact.filename, atsValidation }], status: "FINAL", mergeTarget: target,
      receipt: {
        assertCurrent: async (tx) => {
          const current = await assertClaim(tx, task, access, input.attempt, claim.claimId);
          await assertTaskSources(tx, current);
          await assertApplicationUnchanged(tx, current);
        },
        record: async (tx, result) => {
          const response = committedResponse(result, task, artifact.filename);
          await tx.localTailoringAttempt.update({ where: { taskId_attempt: { taskId: id, attempt: input.attempt } }, data: { response: json(response), claimId: null, claimExpiresAt: null } });
          await tx.localTailoringTask.update({ where: { id }, data: { status: "completed", result: json(response), error: Prisma.DbNull } });
        },
      },
    });
    if (committed.kind !== "committed") throw commitFailure(committed);
    return committedResponse(committed, task, artifact.filename);
  } catch (error) {
    // Authorization errors must not turn an unauthorised request into a task
    // mutation. Domain/source errors occur only after authorisation succeeds.
    if (error instanceof AppError && ["LOCAL_TASK_NOT_FOUND", "LOCAL_TASK_EXPIRED", "LOCAL_TASK_RESULT_CONFLICT", "LOCAL_TASK_ATTEMPT_CONFLICT", "LOCAL_TASK_NOT_ACTIVE"].includes(error.code)) throw error;
    const receipt = await settleFailure(id, access, input.attempt, claimId, error);
    if (receipt) return receipt;
    throw error;
  }
}
