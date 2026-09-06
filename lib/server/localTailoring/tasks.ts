import { randomUUID } from "node:crypto";
import { Prisma, type LocalTailoringTask } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { AppError } from "@/lib/server/api/appError";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { buildApplicationPromptForUser } from "@/lib/server/applications/applicationPrompt";
import { ACTIVE_STATUSES, MAX_ATTEMPTS, TASK_LIFETIME_MS, type TaskAccess } from "./contract";
import { digest, issueTaskCapability, validTaskCapability } from "./capability";
import { readLockedTaskSources } from "./sources";
import { APPLICATION_TARGET_SELECT, applicationTargetHash } from "./applicationTarget";

export function taskError(code: string, message: string, status = 409): AppError {
  return new AppError({ code, publicMessage: message, status });
}

export function taskView(task: LocalTailoringTask) {
  const status = ACTIVE_STATUSES.includes(task.status) && task.expiresAt.getTime() <= Date.now() ? "expired" : task.status;
  return {
    taskId: task.id, jobId: task.jobId, target: task.target, status,
    attempt: task.attempt, maxAttempts: MAX_ATTEMPTS,
    expiresAt: task.expiresAt.toISOString(),
    error: task.error, result: task.result,
    ...(status === "publishing" ? { retryAfterSeconds: 3 } : {}),
  };
}

export function assertTaskAccess(task: LocalTailoringTask | null, access: TaskAccess): asserts task is LocalTailoringTask {
  if (!task || ("userId" in access ? task.userId !== access.userId : !validTaskCapability(access.capability, task.capabilityHash))) {
    throw taskError("LOCAL_TASK_NOT_FOUND", "Local task not found or its authorization is invalid.", 404);
  }
  if ("capability" in access && task.expiresAt.getTime() <= Date.now()) {
    throw taskError("LOCAL_TASK_EXPIRED", "This generation authorization expired. Start a new task.", 410);
  }
}

export async function authorisedTask(id: string, access: TaskAccess) {
  const task = await prisma.localTailoringTask.findUnique({ where: { id } });
  assertTaskAccess(task, access);
  return task;
}

/** Every task mutation shares the Application's lock. Cancellation cannot
 * race past a successful PDF commit or leave a committed task cancelled. */
export async function withTaskTransaction<T>(id: string, access: TaskAccess, run: (tx: Prisma.TransactionClient, task: LocalTailoringTask) => Promise<T>) {
  const initial = await authorisedTask(id, access);
  return prisma.$transaction(async (tx) => {
    await acquireApplicationMutationLock(tx, initial.userId, initial.jobId);
    const task = await tx.localTailoringTask.findUnique({ where: { id } });
    assertTaskAccess(task, access);
    return run(tx, task);
  }, { timeout: 30_000 });
}

export async function createLocalTask(userId: string, input: { jobId: string; target: "resume" | "cover" }) {
  // Reuse the production authorization/locale/profile resolver before entering
  // the bounded transaction; it also establishes default rules and a pointer.
  const prepared = await buildApplicationPromptForUser({ userId, ...input });
  if (!prepared.snapshotBinding) throw taskError("LOCAL_TASK_SOURCE_UNAVAILABLE", "Save your resume before generating.");
  return prisma.$transaction(async (tx) => {
    await acquireApplicationMutationLock(tx, userId, input.jobId);
    const sources = await readLockedTaskSources(tx, { userId, ...input, resumeProfileId: prepared.snapshotBinding!.resumeProfileId });
    if (sources.binding.promptHash !== prepared.promptMeta.promptHash) throw taskError("LOCAL_TASK_SOURCE_CHANGED", "Your source changed. Please try again.");
    const previous = await tx.localTailoringTask.findFirst({
      where: { userId, ...input, status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: "desc" },
    });
    let task = previous;
    if (task && (task.expiresAt.getTime() <= Date.now() || task.promptHash !== sources.binding.promptHash)) {
      await tx.localTailoringTask.update({ where: { id: task.id }, data: {
        status: task.expiresAt.getTime() <= Date.now() ? "expired" : "failed",
        error: { code: "LOCAL_TASK_SOURCE_CHANGED", message: "The source changed. A new task was started." },
      } });
      task = null;
    }
    if (!task) {
      const application = await tx.application.findUnique({ where: { userId_jobId: { userId, jobId: input.jobId } }, select: APPLICATION_TARGET_SELECT });
      const scope = { id: randomUUID(), userId, ...input, expiresAt: new Date(Date.now() + TASK_LIFETIME_MS) };
      task = await tx.localTailoringTask.create({ data: {
        ...scope, capabilityHash: digest(issueTaskCapability(scope)),
        resumeProfileId: sources.profile.id, locale: sources.locale, ...sources.binding,
        expectedTargetHash: applicationTargetHash(application, input.target),
      } });
    }
    const capability = issueTaskCapability(task);
    if (!validTaskCapability(capability, task.capabilityHash)) throw taskError("LOCAL_TASK_RESTART_REQUIRED", "Authorization changed. Cancel this task and start again.");
    return { ...taskView(task), capability, prompt: sources.prompt, model: "gpt-5.6-sol", provider: "openai-codex" };
  }, { timeout: 30_000 });
}

export async function latestLocalTask(userId: string, input: { jobId: string; target: "resume" | "cover" }) {
  const task = await prisma.localTailoringTask.findFirst({ where: { userId, ...input }, orderBy: { createdAt: "desc" } });
  return task ? taskView(task) : null;
}

export async function cancelLocalTask(id: string, access: TaskAccess) {
  return withTaskTransaction(id, access, async (tx, task) => {
    if (!ACTIVE_STATUSES.includes(task.status)) return taskView(task);
    const updated = await tx.localTailoringTask.update({ where: { id }, data: { status: "cancelled", error: Prisma.DbNull } });
    return taskView(updated);
  });
}

export async function progressLocalTask(id: string, access: TaskAccess, attempt: number) {
  return withTaskTransaction(id, access, async (tx, task) => {
    if (!ACTIVE_STATUSES.includes(task.status) || task.status === "publishing") return taskView(task);
    const next = task.status === "repair" ? task.attempt + 1 : Math.max(1, task.attempt);
    if (attempt !== next) throw taskError("LOCAL_TASK_ATTEMPT_CONFLICT", "This attempt does not match the task's current progress.");
    return taskView(await tx.localTailoringTask.update({ where: { id }, data: { status: "generating", attempt } }));
  });
}

export async function failLocalTask(id: string, access: TaskAccess) {
  return withTaskTransaction(id, access, async (tx, task) => {
    if (!ACTIVE_STATUSES.includes(task.status)) return taskView(task);
    return taskView(await tx.localTailoringTask.update({ where: { id }, data: {
      status: "failed", error: { code: "LOCAL_GENERATION_FAILED", message: "The local model could not finish. Check its connection and authorization, then try again." },
    } }));
  });
}
