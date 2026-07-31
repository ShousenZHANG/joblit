import { Prisma } from "@/lib/generated/prisma";
import { buildTriagePromptForUser } from "@/lib/server/applications/applicationPrompt";
import {
  buildPromptSnapshotHash,
  validatePromptMetaForImport,
} from "@/lib/server/ai/promptContract";
import { verdictForScore } from "@/lib/server/ai/fitScoring";
import { prisma } from "@/lib/server/prisma";
import { fitClaimSource } from "@/lib/server/jobs/fitRunService";
import { z } from "zod";

export const FIT_BATCH_PROTOCOL_VERSION = 1 as const;
const FIT_IMPORT_LOCK_NAMESPACE = 0x46495442; // "FITB"
const MAX_MODEL_OUTPUT_CHARS = 80_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const PromptMetaSchema = z
  .object({
    ruleSetId: z.string().min(1),
    resumeSnapshotUpdatedAt: z.string().min(1),
    promptTemplateVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
    skillPackVersion: z.string().regex(HASH_PATTERN),
    promptHash: z.string().regex(HASH_PATTERN),
  })
  .strict();

export const FitBatchImportRequestSchema = z
  .object({
    jobIds: z.array(z.string().uuid()).min(1).max(15),
    claimToken: z.string().uuid(),
    issueKey: z.string().regex(HASH_PATTERN),
    modelOutput: z.string().min(2).max(MAX_MODEL_OUTPUT_CHARS),
    promptMeta: PromptMetaSchema,
  })
  .strict();

const TriageEntrySchema = z
  .object({
    jobId: z.string().uuid(),
    matchScore: z.number().int().min(0).max(100),
    reason: z.string().max(200).optional(),
  })
  // Models sometimes add stray keys; only the validated ones are used.
  .loose();

const ScoredJobSchema = z
  .object({
    jobId: z.string().uuid(),
    fitScore: z.number().int().min(0).max(100),
    fitVerdict: z.enum(["STRONG", "GOOD", "MODERATE", "WEAK", "POOR"]),
  })
  .strict();

export const FitBatchSettlementSchema = z
  .object({
    protocolVersion: z.literal(FIT_BATCH_PROTOCOL_VERSION),
    issueKey: z.string().regex(HASH_PATTERN),
    requestHash: z.string().regex(HASH_PATTERN),
    scored: z.array(ScoredJobSchema).min(1).max(15),
  })
  .strict();

export type FitBatchImportBody = z.infer<typeof FitBatchImportRequestSchema>;
export type FitBatchImportRequest = FitBatchImportBody & { userId: string };
export type FitBatchSettlement = z.infer<typeof FitBatchSettlementSchema>;

export type FitBatchImportErrorCode =
  | "INVALID_AI_RESULT"
  | "FIT_ISSUE_MISMATCH"
  | "FIT_PROMPT_MISMATCH"
  | "FIT_RECEIPT_CONFLICT"
  | "FIT_RECEIPT_INVALID"
  | "FIT_CLAIM_EXPIRED";

export class FitBatchImportError extends Error {
  constructor(
    public readonly code: FitBatchImportErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "FitBatchImportError";
  }
}

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function requestHashFor(request: FitBatchImportRequest): string {
  return buildPromptSnapshotHash({
    protocol: "fit-batch-import/v1",
    issueKey: request.issueKey,
    jobIds: [...new Set(request.jobIds)].sort(),
    modelOutput: request.modelOutput,
    promptMeta: request.promptMeta,
  });
}

function replaySettlement(
  receipt: {
    requestHash: string;
    settlement: unknown;
  },
  issueKey: string,
  requestHash: string,
): FitBatchSettlement {
  if (receipt.requestHash !== requestHash) {
    throw new FitBatchImportError(
      "FIT_RECEIPT_CONFLICT",
      "This Fit issue was already settled by a different result.",
      409,
    );
  }
  const parsed = FitBatchSettlementSchema.safeParse(receipt.settlement);
  if (
    !parsed.success ||
    parsed.data.issueKey !== issueKey ||
    parsed.data.requestHash !== receipt.requestHash
  ) {
    throw new FitBatchImportError(
      "FIT_RECEIPT_INVALID",
      "The persisted Fit settlement is invalid.",
      500,
      parsed.success ? undefined : parsed.error.flatten(),
    );
  }
  return parsed.data;
}

async function findReceipt(
  userId: string,
  issueKey: string,
): Promise<{ requestHash: string; settlement: unknown } | null> {
  return prisma.fitBatchImportReceipt.findUnique({
    where: { userId_issueKey: { userId, issueKey } },
    select: { requestHash: true, settlement: true },
  });
}

/**
 * Read the authoritative settlement for crash recovery without replaying model
 * output. The Agent may use this only to decide whether a completed local
 * Hermes result is safe to forget.
 */
export async function readFitBatchSettlement(
  userId: string,
  issueKey: string,
): Promise<FitBatchSettlement | null> {
  const receipt = await findReceipt(userId, issueKey);
  if (!receipt) return null;
  const parsed = FitBatchSettlementSchema.safeParse(receipt.settlement);
  if (
    !parsed.success ||
    parsed.data.issueKey !== issueKey ||
    parsed.data.requestHash !== receipt.requestHash
  ) {
    throw new FitBatchImportError(
      "FIT_RECEIPT_INVALID",
      "The persisted Fit settlement is invalid.",
      500,
      parsed.success ? undefined : parsed.error.flatten(),
    );
  }
  return parsed.data;
}

/**
 * Commit one Fit batch behind a durable exact-replay receipt.
 *
 * A replay checks the receipt before rebuilding the prompt, so a response
 * lost after commit remains recoverable even if the user's current resume or
 * rules have changed. A first commit verifies the content-addressed issue
 * against fresh server-owned prompt inputs, then writes Jobs and receipt in
 * the same transaction.
 */
export async function settleFitBatchImport(
  request: FitBatchImportRequest,
): Promise<FitBatchSettlement> {
  const requestHash = requestHashFor(request);
  const existing = await findReceipt(request.userId, request.issueKey);
  if (existing) return replaySettlement(existing, request.issueKey, requestHash);

  const issued = await buildTriagePromptForUser({
    userId: request.userId,
    jobIds: request.jobIds,
  });
  if (issued.issueKey !== request.issueKey) {
    throw new FitBatchImportError(
      "FIT_ISSUE_MISMATCH",
      "The Fit issue does not match the current server-owned prompt.",
      409,
    );
  }
  const promptValidation = validatePromptMetaForImport({
    expected: issued.promptMeta,
    received: request.promptMeta,
  });
  if (!promptValidation.ok) {
    throw new FitBatchImportError(
      "FIT_PROMPT_MISMATCH",
      "The Fit prompt receipt no longer matches the current prompt.",
      409,
      promptValidation.mismatches,
    );
  }

  const entries = z
    .array(TriageEntrySchema)
    .min(1)
    .max(30)
    .safeParse(extractJsonArray(request.modelOutput));
  if (!entries.success) {
    throw new FitBatchImportError(
      "INVALID_AI_RESULT",
      "The triage result did not match the required schema.",
      400,
      entries.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    );
  }

  const allowed = new Set(request.jobIds);
  const seen = new Set<string>();
  const updates = entries.data.filter((entry) => {
    if (!allowed.has(entry.jobId) || seen.has(entry.jobId)) return false;
    seen.add(entry.jobId);
    return true;
  });
  if (updates.length === 0) {
    throw new FitBatchImportError(
      "INVALID_AI_RESULT",
      "The triage result did not reference any job from this batch.",
      400,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        ${FIT_IMPORT_LOCK_NAMESPACE}::integer,
        ${stableInt32(request.issueKey)}::integer
      )
    `;

    const replay = await tx.fitBatchImportReceipt.findUnique({
      where: {
        userId_issueKey: {
          userId: request.userId,
          issueKey: request.issueKey,
        },
      },
      select: { requestHash: true, settlement: true },
    });
    if (replay) {
      return replaySettlement(replay, request.issueKey, requestHash);
    }

    const now = new Date();
    const scored: FitBatchSettlement["scored"] = [];
    for (const entry of updates) {
      const write = await tx.job.updateMany({
        where: {
          id: entry.jobId,
          userId: request.userId,
          status: "NEW",
          fitScoredAt: null,
          fitSource: fitClaimSource(request.claimToken),
        },
        data: {
          fitScore: entry.matchScore,
          fitVerdict: verdictForScore(entry.matchScore),
          fitEligibility: null,
          fitSource: "batch",
          fitScoredAt: now,
          fitSnapshotHash: request.promptMeta.resumeSnapshotUpdatedAt,
        },
      });
      if (write.count === 1) {
        scored.push({
          jobId: entry.jobId,
          fitScore: entry.matchScore,
          fitVerdict: verdictForScore(entry.matchScore),
        });
      }
    }
    if (scored.length === 0) {
      throw new FitBatchImportError(
        "FIT_CLAIM_EXPIRED",
        "This scoring batch is no longer active. Start or resume the scan.",
        409,
      );
    }

    const settlement: FitBatchSettlement = {
      protocolVersion: FIT_BATCH_PROTOCOL_VERSION,
      issueKey: request.issueKey,
      requestHash,
      scored,
    };
    await tx.fitBatchImportReceipt.create({
      data: {
        userId: request.userId,
        issueKey: request.issueKey,
        requestHash,
        settlement: settlement as Prisma.InputJsonValue,
      },
    });
    return settlement;
  });
}
