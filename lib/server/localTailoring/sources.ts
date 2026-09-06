import type { LocalTailoringTask, Prisma } from "@/lib/generated/prisma";
import { AppError } from "@/lib/server/api/appError";
import { lockOwnedApplicationSources } from "@/lib/server/applications/applicationSourceSnapshot";
import { buildPromptSnapshotHash } from "@/lib/server/ai/promptContract";
import { buildApplicationPromptFromSources } from "@/lib/server/applications/applicationPrompt";
import { sanitizePromptCvRules, sanitizePromptCoverRules, sanitizePromptHardConstraints } from "@/lib/server/promptRuleTemplates";
import { marketStringToResumeLocale } from "@/lib/shared/market";

export function staleSource(): AppError {
  return new AppError({ code: "LOCAL_TASK_SOURCE_CHANGED", status: 409, publicMessage: "Your resume, job or tailoring rules changed. Start a new generation." });
}

/** Called under JOBA. Source row locks precede the active pointer, matching
 * profile mutation order; no network or model work runs in this transaction. */
export async function readLockedTaskSources(tx: Prisma.TransactionClient, scope: {
  userId: string; jobId: string; resumeProfileId: string; target: string;
}) {
  const locked = await lockOwnedApplicationSources(tx, scope);
  if (!locked) throw staleSource();
  const locale = marketStringToResumeLocale(locked.job.market);
  await tx.$queryRaw`SELECT "id" FROM "ActiveResumeProfile" WHERE "userId" = ${scope.userId}::uuid AND "locale" = ${locale} FOR SHARE`;
  const pointer = await tx.activeResumeProfile.findUnique({ where: { userId_locale: { userId: scope.userId, locale } } });
  const profile = await tx.resumeProfile.findFirst({ where: { id: scope.resumeProfileId, userId: scope.userId, locale } });
  const readTemplate = async () => (await tx.promptRuleTemplate.findFirst({ where: { userId: scope.userId, isActive: true }, orderBy: { updatedAt: "desc" } }))
    ?? await tx.promptRuleTemplate.findFirst({ where: { userId: scope.userId }, orderBy: { version: "desc" } });
  const selected = await readTemplate();
  if (!selected) throw staleSource();
  // Activation locks the current active rule before its replacement. Locking
  // every inactive rule in id order would invert that order and deadlock.
  await tx.$queryRaw`SELECT "id" FROM "PromptRuleTemplate" WHERE "userId" = ${scope.userId}::uuid AND "id" = ${selected.id}::uuid FOR SHARE`;
  const template = await readTemplate();
  if (template?.id !== selected.id) throw staleSource();
  if (!profile || pointer?.resumeProfileId !== profile.id || !template) throw staleSource();
  const rules = {
    id: template.id,
    locale: "en-AU" as const,
    cvRules: sanitizePromptCvRules(template.cvRules),
    coverRules: sanitizePromptCoverRules(template.coverRules),
    hardConstraints: sanitizePromptHardConstraints(template.hardConstraints),
  };
  const target = scope.target === "cover" ? "cover" : "resume";
  const prepared = await buildApplicationPromptFromSources({ target, profile, job: locked.job, rules });
  if (!prepared.snapshotBinding) throw staleSource();
  return {
    profile, job: locked.job, locale, prompt: { instructions: prepared.prompt.instructions, input: prepared.prompt.input },
    binding: {
      promptHash: prepared.promptMeta.promptHash,
      resumeSnapshotHash: prepared.snapshotBinding.resumeSnapshotHash,
      jobSnapshotHash: prepared.snapshotBinding.jobSnapshotHash,
      rulesHash: buildPromptSnapshotHash(rules),
      profileUpdatedAt: profile.updatedAt,
    },
  };
}

export async function assertTaskSources(tx: Prisma.TransactionClient, task: LocalTailoringTask) {
  const current = await readLockedTaskSources(tx, task);
  if (current.binding.promptHash !== task.promptHash
    || current.binding.resumeSnapshotHash !== task.resumeSnapshotHash
    || current.binding.jobSnapshotHash !== task.jobSnapshotHash
    || current.binding.rulesHash !== task.rulesHash
    || current.profile.updatedAt.getTime() !== task.profileUpdatedAt.getTime()
    || current.locale !== task.locale) throw staleSource();
  return current;
}
