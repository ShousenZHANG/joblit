import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import type {
  TailoringRunDelivery,
  TailoringRunSource,
  TailoringRunStatus,
  TailoringRunTarget,
} from "./tailoringRunProtocol";

export type TailoringBatchTaskRow = {
  id: string;
  batchId: string;
  userId: string;
  jobId: string;
  status: string;
  executionAttemptId: string | null;
  tailoringProtocolVersion: number;
  completionAttemptId: string | null;
};

export type TailoringReceiptRow = {
  runId: string;
  target: TailoringRunTarget;
  executionAttemptId: string;
  requestHash: string;
  applicationId: string | null;
  aiContentHash: string;
  documentContentHash: string | null;
  delivery: TailoringRunDelivery;
};

export type TailoringRunRow = {
  id: string;
  userId: string;
  jobId: string;
  resumeProfileId: string | null;
  applicationBatchTaskId: string | null;
  applicationId: string | null;
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  status: TailoringRunStatus;
  requiredTargetMask: number;
  acceptedTargetMask: number;
  issueKey: string;
  issueHash: string;
  promptReceipts: unknown;
  resumeSnapshotHash: string;
  jobSnapshotHash: string;
  executionAttemptId: string | null;
  executionLeaseExpiresAt: Date | null;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  terminalAt: Date | null;
  applicationBatchTask?: TailoringBatchTaskRow | null;
  receipts?: TailoringReceiptRow[];
};

type QueryArgs = Record<string, unknown>;

export type TailoringRunTransaction = {
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
  tailoringRun: {
    findUnique(args: QueryArgs): Promise<TailoringRunRow | null>;
    findFirst(args: QueryArgs): Promise<TailoringRunRow | null>;
    findMany(args: QueryArgs): Promise<TailoringRunRow[]>;
    create(args: QueryArgs): Promise<TailoringRunRow>;
    update(args: QueryArgs): Promise<TailoringRunRow>;
    updateMany(args: QueryArgs): Promise<{ count: number }>;
  };
  tailoringRunReceipt: {
    findMany(args: QueryArgs): Promise<TailoringReceiptRow[]>;
    create(args: QueryArgs): Promise<TailoringReceiptRow>;
  };
  applicationBatchTask: {
    findFirst(args: QueryArgs): Promise<TailoringBatchTaskRow | null>;
    updateMany(args: QueryArgs): Promise<{ count: number }>;
    groupBy(
      args: QueryArgs,
    ): Promise<Array<{ status: string; _count: { _all: number } }>>;
  };
  applicationBatch: {
    findFirst(args: QueryArgs): Promise<{
      id: string;
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
    } | null>;
    update(args: QueryArgs): Promise<unknown>;
  };
  job: {
    findFirst(args: QueryArgs): Promise<{ id: string } | null>;
  };
  resumeProfile: {
    findFirst(args: QueryArgs): Promise<{ id: string } | null>;
  };
};

export type TailoringRunDatabase = TailoringRunTransaction & {
  $transaction<T>(
    callback: (tx: TailoringRunTransaction) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T>;
};

export type TailoringRunDependencies = {
  database: TailoringRunDatabase;
  now: () => Date;
  randomUuid: () => string;
};

const DEFAULT_DEPENDENCIES: TailoringRunDependencies = {
  database: prisma as unknown as TailoringRunDatabase,
  now: () => new Date(),
  randomUuid: randomUUID,
};

export function tailoringRunDependencies(
  overrides?: Partial<TailoringRunDependencies>,
): TailoringRunDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}
