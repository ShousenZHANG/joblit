import { Prisma } from "@/lib/generated/prisma";
import { buildTriagePromptForUser } from "@/lib/server/applications/applicationPrompt";
import {
  buildPromptSnapshotHash,
  validatePromptMetaForImport,
} from "@/lib/server/ai/promptContract";
import { verdictForScore } from "@/lib/server/ai/fitScoring";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { prisma } from "@/lib/server/prisma";
import {
  acquireFitClaimLock,
  bindFitBatchPrompt,
  FitBatchClaimError,
  fitClaimSource,
} from "@/lib/server/jobs/fitRunService";
import { z } from "zod";

export const FIT_BATCH_PROTOCOL_VERSION = 1 as const;
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
    jobIds: z
      .array(z.string().uuid())
      .min(1)
      .max(15)
      .refine((jobIds) => new Set(jobIds).size === jobIds.length, {
        message: "jobIds must be unique",
      }),
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

const FailedJobSchema = z
  .object({
    jobId: z.string().uuid(),
    code: z.enum(["MODEL_RESULT_MISSING", "JOB_UNAVAILABLE"]),
  })
  .strict();

export const FitBatchSettlementSchema = z
  .object({
    protocolVersion: z.literal(FIT_BATCH_PROTOCOL_VERSION),
    issueKey: z.string().regex(HASH_PATTERN),
    requestHash: z.string().regex(HASH_PATTERN),
    scored: z.array(ScoredJobSchema).max(15),
    failed: z.array(FailedJobSchema).max(15).optional().default([]),
  })
  .refine((value) => value.scored.length + value.failed.length > 0, {
    message: "A Fit settlement must account for at least one Job.",
  })
  .refine(
    (value) => {
      const jobIds = [
        ...value.scored.map((entry) => entry.jobId),
        ...value.failed.map((entry) => entry.jobId),
      ];
      return jobIds.length <= 15 && new Set(jobIds).size === jobIds.length;
    },
    { message: "A Fit settlement must account for each Job at most once." },
  )
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
  | "FIT_CLAIM_EXPIRED"
  | "FIT_ATTEMPT_STALE";

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

export type FitBatchSettlementState =
  | {
      state: "UNSETTLED";
      settlement: null;
      claim: {
        id: string;
        attemptId: string;
        leaseExpiresAt: string | null;
      } | null;
    }
  | {
      state: "SETTLED";
      settlement: FitBatchSettlement;
      claim: null;
    }
  | {
      state: "TERMINAL_UNSETTLED";
      settlement: null;
      claim: { id: string; reason: "FAILED" | "CANCELLED" | "SUPERSEDED" };
    };

/**
 * Authoritative three-state recovery view. A transport timeout is not a fourth
 * server state: the Runner resolves it through this receipt-first query.
 */
export async function readFitBatchSettlementState(
  userId: string,
  issueKey: string,
): Promise<FitBatchSettlementState> {
  const settlement = await readFitBatchSettlement(userId, issueKey);
  if (settlement) {
    return { state: "SETTLED", settlement, claim: null };
  }
  const claim = await prisma.fitBatchClaim.findFirst({
    where: { userId, issueKey },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      executionAttemptId: true,
      executionLeaseExpiresAt: true,
    },
  });
  if (!claim || claim.status === "ACTIVE") {
    return {
      state: "UNSETTLED",
      settlement: null,
      claim: claim
        ? {
            id: claim.id,
            attemptId: claim.executionAttemptId,
            leaseExpiresAt:
              claim.executionLeaseExpiresAt?.toISOString() ?? null,
          }
        : null,
    };
  }
  if (claim.status === "SETTLED") {
    // The receipt and Claim commit atomically, but the first receipt read and
    // this Claim read are separate statements. A settlement may commit in
    // between them, so close that TOCTOU window with one final receipt-first
    // read before diagnosing corruption.
    const committedSettlement = await readFitBatchSettlement(userId, issueKey);
    if (committedSettlement) {
      return {
        state: "SETTLED",
        settlement: committedSettlement,
        claim: null,
      };
    }
    throw new FitBatchImportError(
      "FIT_RECEIPT_INVALID",
      "A settled Fit Claim has no durable receipt.",
      500,
    );
  }
  return {
    state: "TERMINAL_UNSETTLED",
    settlement: null,
    claim: { id: claim.id, reason: claim.status },
  };
}

function exactJobSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return (
    left.length === right.length &&
    left.every((jobId, index) => jobId === right[index])
  );
}

type FitImportTransaction = Prisma.TransactionClient;

function assertIssuedPromptMatchesRequest(
  issued: Awaited<ReturnType<typeof buildTriagePromptForUser>>,
  request: FitBatchImportRequest,
): void {
  if (issued.issueKey !== request.issueKey) {
    throw new FitBatchImportError(
      "FIT_ISSUE_MISMATCH",
      "The Fit issue does not match the current server-owned prompt.",
      409,
    );
  }
  const validation = validatePromptMetaForImport({
    expected: issued.promptMeta,
    received: request.promptMeta,
  });
  if (!validation.ok) {
    throw new FitBatchImportError(
      "FIT_PROMPT_MISMATCH",
      "The Fit prompt receipt no longer matches the current prompt.",
      409,
      validation.mismatches,
    );
  }
}

function rethrowClaimBindingError(error: unknown): never {
  if (!(error instanceof FitBatchClaimError)) throw error;
  const code: FitBatchImportErrorCode =
    error.code === "FIT_PROMPT_MISMATCH"
      ? "FIT_PROMPT_MISMATCH"
      : error.code === "FIT_ATTEMPT_STALE"
        ? "FIT_ATTEMPT_STALE"
        : error.code === "FIT_CLAIM_EXPIRED" ||
            error.code === "FIT_CLAIM_NOT_FOUND"
          ? "FIT_CLAIM_EXPIRED"
          : "FIT_ISSUE_MISMATCH";
  throw new FitBatchImportError(code, error.message, error.status);
}

/**
 * A v2 Claim can still be unbound when its prompt request lands on a rolling
 * v1 server. Resolve that attempt before the legacy adapter is considered, or
 * the v1 Job projection would bypass durable Claim settlement.
 */
async function bindUnboundDurableClaimForImport(
  request: FitBatchImportRequest,
): Promise<void> {
  const claim = await prisma.fitBatchClaim.findFirst({
    where: {
      userId: request.userId,
      executionAttemptId: request.claimToken,
    },
    select: {
      id: true,
      status: true,
      issueKey: true,
      items: { orderBy: { ordinal: "asc" }, select: { jobId: true } },
    },
  });
  if (!claim) return;
  if (claim.status !== "ACTIVE") {
    throw new FitBatchImportError(
      "FIT_CLAIM_EXPIRED",
      "This Fit Claim is terminal and has no accepted receipt.",
      409,
    );
  }
  if (
    !exactJobSet(
      claim.items.map((item) => item.jobId),
      request.jobIds,
    )
  ) {
    throw new FitBatchImportError(
      "FIT_ISSUE_MISMATCH",
      "The settlement must echo the Claim's exact Job set.",
      409,
    );
  }
  if (claim.issueKey) {
    if (claim.issueKey !== request.issueKey) {
      throw new FitBatchImportError(
        "FIT_ISSUE_MISMATCH",
        "The settlement issue does not match the durable Claim.",
        409,
      );
    }
    return;
  }

  const issued = await buildTriagePromptForUser({
    userId: request.userId,
    jobIds: request.jobIds,
  });
  assertIssuedPromptMatchesRequest(issued, request);
  try {
    await bindFitBatchPrompt(request.userId, request.jobIds, issued, {
      claimId: claim.id,
      attemptId: request.claimToken,
    });
  } catch (error) {
    rethrowClaimBindingError(error);
  }
}

async function reconcileActiveClaimWithReceipt(
  tx: FitImportTransaction,
  request: FitBatchImportRequest,
  settlement: FitBatchSettlement,
): Promise<void> {
  const claim = await tx.fitBatchClaim.findFirst({
    where: { userId: request.userId, status: "ACTIVE" },
    include: {
      items: {
        orderBy: { ordinal: "asc" },
        select: { jobId: true },
      },
    },
  });
  if (!claim) return;

  const claimedJobIds = claim.items.map((item) => item.jobId);
  const associated =
    exactJobSet(claimedJobIds, request.jobIds) &&
    (claim.issueKey === request.issueKey ||
      claim.executionAttemptId === request.claimToken);
  if (!associated) return;

  const scoredJobIds = new Set(settlement.scored.map((entry) => entry.jobId));
  const failedByJobId = new Map(
    settlement.failed.map((entry) => [entry.jobId, entry.code] as const),
  );
  const claimed = new Set(claimedJobIds);
  for (const jobId of [...scoredJobIds, ...failedByJobId.keys()]) {
    if (!claimed.has(jobId)) {
      throw new FitBatchImportError(
        "FIT_RECEIPT_INVALID",
        "The persisted Fit settlement references a Job outside its Claim.",
        500,
      );
    }
  }

  const missingJobIds = claimedJobIds.filter(
    (jobId) => !scoredJobIds.has(jobId) && !failedByJobId.has(jobId),
  );
  const now = new Date();
  for (const jobId of claimedJobIds) {
    const failedCode = failedByJobId.get(jobId);
    await tx.fitBatchClaimItem.update({
      where: { claimId_jobId: { claimId: claim.id, jobId } },
      data: scoredJobIds.has(jobId)
        ? { outcome: "SCORED", failureCode: null, releasedAt: now }
        : {
            outcome: "FAILED",
            failureCode: failedCode ?? "LEGACY_RECEIPT_INCOMPLETE",
            releasedAt: now,
          },
    });
  }
  if (missingJobIds.length > 0) {
    await tx.job.updateMany({
      where: {
        id: { in: missingJobIds },
        userId: request.userId,
        status: "NEW",
        fitScoredAt: null,
        fitSource: fitClaimSource(claim.executionAttemptId),
      },
      data: { fitSource: null },
    });
  }

  const exactBoundSettlement =
    claim.issueKey === request.issueKey && missingJobIds.length === 0;
  await tx.fitBatchClaim.update({
    where: { id: claim.id },
    data: exactBoundSettlement
      ? {
          status: "SETTLED",
          executionLeaseExpiresAt: null,
          settledAt: now,
          errorCode: null,
          errorMessage: null,
        }
      : {
          status: "SUPERSEDED",
          executionLeaseExpiresAt: null,
          errorCode: "LEGACY_RECEIPT_RECONCILED",
          errorMessage:
            "A rolling v1 receipt was accepted outside the durable Claim transaction.",
          terminalAt: now,
        },
  });
}

async function replayReceiptWithClaimReconciliation(
  request: FitBatchImportRequest,
  requestHash: string,
  receipt: { requestHash: string; settlement: unknown },
): Promise<FitBatchSettlement> {
  replaySettlement(receipt, request.issueKey, requestHash);
  return prisma.$transaction(async (tx) => {
    await acquireJobMutationLock(tx, request.userId);
    await acquireFitClaimLock(tx, request.userId);
    const current = await tx.fitBatchImportReceipt.findUnique({
      where: {
        userId_issueKey: {
          userId: request.userId,
          issueKey: request.issueKey,
        },
      },
      select: { requestHash: true, settlement: true },
    });
    if (!current) {
      throw new FitBatchImportError(
        "FIT_RECEIPT_INVALID",
        "The persisted Fit settlement disappeared during reconciliation.",
        500,
      );
    }
    const settlement = replaySettlement(current, request.issueKey, requestHash);
    await reconcileActiveClaimWithReceipt(tx, request, settlement);
    return settlement;
  });
}

function parseTriageEntries(request: FitBatchImportRequest) {
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
  for (const entry of entries.data) {
    if (!allowed.has(entry.jobId) || seen.has(entry.jobId)) {
      throw new FitBatchImportError(
        "INVALID_AI_RESULT",
        "The triage result contains an unknown or duplicate Job.",
        400,
      );
    }
    seen.add(entry.jobId);
  }
  return new Map(entries.data.map((entry) => [entry.jobId, entry]));
}

/**
 * Commit one exact Fit Claim behind a durable receipt. New protocol claims use
 * their immutable stored prompt receipt; only a rolling-deploy v1 claim falls
 * back to rebuilding the prompt. Every Job is accounted for as scored or
 * failed in the same JOBJ -> JOBF transaction.
 */
export async function settleFitBatchImport(
  request: FitBatchImportRequest,
): Promise<FitBatchSettlement> {
  const requestHash = requestHashFor(request);
  const existing = await findReceipt(request.userId, request.issueKey);
  if (existing) {
    return replayReceiptWithClaimReconciliation(request, requestHash, existing);
  }

  const entriesByJobId = parseTriageEntries(request);
  await bindUnboundDurableClaimForImport(request);
  const durableBefore = await prisma.fitBatchClaim.findFirst({
    where: { userId: request.userId, issueKey: request.issueKey },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  const legacyIssued = durableBefore
    ? null
    : await buildTriagePromptForUser({
        userId: request.userId,
        jobIds: request.jobIds,
      });

  if (legacyIssued) {
    assertIssuedPromptMatchesRequest(legacyIssued, request);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await acquireJobMutationLock(tx, request.userId);
      await acquireFitClaimLock(tx, request.userId);

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
        const settlement = replaySettlement(
          replay,
          request.issueKey,
          requestHash,
        );
        await reconcileActiveClaimWithReceipt(tx, request, settlement);
        return settlement;
      }

      const claim = await tx.fitBatchClaim.findFirst({
        where: { userId: request.userId, issueKey: request.issueKey },
        orderBy: { updatedAt: "desc" },
        include: {
          items: {
            orderBy: { ordinal: "asc" },
            select: { jobId: true },
          },
        },
      });
      const now = new Date();

      if (claim) {
        const claimedJobIds = claim.items.map((item) => item.jobId);
        if (!exactJobSet(claimedJobIds, request.jobIds)) {
          throw new FitBatchImportError(
            "FIT_ISSUE_MISMATCH",
            "The settlement must echo the Claim's exact Job set.",
            409,
          );
        }
        if (claim.status !== "ACTIVE") {
          throw new FitBatchImportError(
            "FIT_CLAIM_EXPIRED",
            "This Fit Claim is terminal and has no accepted receipt.",
            409,
          );
        }
        if (claim.executionAttemptId !== request.claimToken) {
          throw new FitBatchImportError(
            "FIT_ATTEMPT_STALE",
            "The Fit Claim attempt has been superseded.",
            409,
          );
        }
        if (
          !claim.executionLeaseExpiresAt ||
          claim.executionLeaseExpiresAt <= now
        ) {
          throw new FitBatchImportError(
            "FIT_CLAIM_EXPIRED",
            "The Fit Claim lease expired. Reacquire it before settlement.",
            409,
          );
        }
        const storedPromptMeta = PromptMetaSchema.safeParse(claim.promptMeta);
        if (
          !claim.promptMetaHash ||
          !storedPromptMeta.success ||
          claim.promptMetaHash !== buildPromptSnapshotHash(request.promptMeta)
        ) {
          throw new FitBatchImportError(
            "FIT_PROMPT_MISMATCH",
            "The settlement prompt receipt does not match the durable Claim.",
            409,
          );
        }
        const promptValidation = validatePromptMetaForImport({
          expected: storedPromptMeta.data,
          received: request.promptMeta,
        });
        if (!promptValidation.ok) {
          throw new FitBatchImportError(
            "FIT_PROMPT_MISMATCH",
            "The settlement prompt receipt does not match the durable Claim.",
            409,
            promptValidation.mismatches,
          );
        }

        const scored: FitBatchSettlement["scored"] = [];
        const failed: NonNullable<FitBatchSettlement["failed"]> = [];
        for (const item of claim.items) {
          const entry = entriesByJobId.get(item.jobId);
          let outcome: "SCORED" | "FAILED" = "FAILED";
          let failureCode: "MODEL_RESULT_MISSING" | "JOB_UNAVAILABLE" | null =
            entry ? "JOB_UNAVAILABLE" : "MODEL_RESULT_MISSING";

          if (entry) {
            const write = await tx.job.updateMany({
              where: {
                id: item.jobId,
                userId: request.userId,
                status: "NEW",
                fitScoredAt: null,
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
              outcome = "SCORED";
              failureCode = null;
              scored.push({
                jobId: item.jobId,
                fitScore: entry.matchScore,
                fitVerdict: verdictForScore(entry.matchScore),
              });
            }
          } else {
            const failedWrite = await tx.job.updateMany({
              where: {
                id: item.jobId,
                userId: request.userId,
                status: "NEW",
                fitScoredAt: null,
              },
              data: { fitSource: "failed", fitScoredAt: now },
            });
            failureCode =
              failedWrite.count === 1
                ? "MODEL_RESULT_MISSING"
                : "JOB_UNAVAILABLE";
          }

          if (failureCode) {
            failed.push({ jobId: item.jobId, code: failureCode });
          }
          await tx.fitBatchClaimItem.update({
            where: { claimId_jobId: { claimId: claim.id, jobId: item.jobId } },
            data: { outcome, failureCode, releasedAt: now },
          });
        }

        const settlement: FitBatchSettlement = {
          protocolVersion: FIT_BATCH_PROTOCOL_VERSION,
          issueKey: request.issueKey,
          requestHash,
          scored,
          failed,
        };
        await tx.fitBatchImportReceipt.create({
          data: {
            userId: request.userId,
            issueKey: request.issueKey,
            requestHash,
            settlement: settlement as Prisma.InputJsonValue,
            protocolVersion: claim.protocolVersion,
            claimId: claim.id,
            executionAttemptId: request.claimToken,
          },
        });
        await tx.fitBatchClaim.update({
          where: { id: claim.id },
          data: {
            status: "SETTLED",
            executionLeaseExpiresAt: null,
            settledAt: now,
            errorCode: null,
            errorMessage: null,
          },
        });
        return settlement;
      }

      // v1 rolling-deploy fallback. It retains the old Job projection authority
      // but now also accounts for every requested Job in the receipt.
      const scored: FitBatchSettlement["scored"] = [];
      const failed: NonNullable<FitBatchSettlement["failed"]> = [];
      let ownedProjectionCount = 0;
      for (const jobId of [...request.jobIds].sort()) {
        const entry = entriesByJobId.get(jobId);
        if (!entry) {
          const failedWrite = await tx.job.updateMany({
            where: {
              id: jobId,
              userId: request.userId,
              status: "NEW",
              fitScoredAt: null,
              fitSource: fitClaimSource(request.claimToken),
            },
            data: { fitSource: "failed", fitScoredAt: now },
          });
          failed.push({
            jobId,
            code:
              failedWrite.count === 1
                ? "MODEL_RESULT_MISSING"
                : "JOB_UNAVAILABLE",
          });
          ownedProjectionCount += failedWrite.count;
          continue;
        }
        const write = await tx.job.updateMany({
          where: {
            id: jobId,
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
          ownedProjectionCount += 1;
          scored.push({
            jobId,
            fitScore: entry.matchScore,
            fitVerdict: verdictForScore(entry.matchScore),
          });
        } else {
          failed.push({ jobId, code: "JOB_UNAVAILABLE" });
        }
      }
      if (ownedProjectionCount === 0) {
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
        failed,
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
  } catch (error) {
    // A rolling v1 importer does not acquire JOBF. It can win the receipt
    // unique key after our in-transaction miss; recover that committed receipt
    // exactly instead of surfacing a transient P2002 as a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const racedReceipt = await findReceipt(request.userId, request.issueKey);
      if (racedReceipt) {
        return replayReceiptWithClaimReconciliation(
          request,
          requestHash,
          racedReceipt,
        );
      }
    }
    throw error;
  }
}
