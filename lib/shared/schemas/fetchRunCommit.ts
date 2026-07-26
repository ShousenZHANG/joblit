import { z } from "zod";
import { FETCH_RUN_COMMIT_PROTOCOL } from "@/lib/shared/fetchRunProtocol";
import { ImportJobItemSchema } from "./jobImport";

export const FetchRunCommitProtocolSchema = z.literal(
  FETCH_RUN_COMMIT_PROTOCOL,
);

export const FetchRunCommitStartCommandSchema = z.object({
  protocol: FetchRunCommitProtocolSchema,
  command: z.literal("start"),
  attemptId: z.string().uuid(),
});

export const FetchRunCommitBatchCommandSchema = z
  .object({
    protocol: FetchRunCommitProtocolSchema,
    command: z.literal("commit"),
    attemptId: z.string().uuid(),
    batchKey: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9:_-]+$/),
    batchIndex: z.number().int().min(0).max(10_000),
    batchCount: z.number().int().min(1).max(10_000),
    items: z.array(ImportJobItemSchema).max(200),
    terminal: z.boolean(),
    discoveredCount: z.number().int().min(0).max(1_000_000).optional(),
    terminalOutcome: z.enum(["SUCCEEDED", "PARTIAL"]).optional(),
    error: z.string().trim().min(1).max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.batchIndex >= value.batchCount) {
      context.addIssue({
        code: "custom",
        path: ["batchIndex"],
        message: "batchIndex must be smaller than batchCount",
      });
    }
    if (value.terminalOutcome && !value.terminal) {
      context.addIssue({
        code: "custom",
        path: ["terminalOutcome"],
        message: "terminalOutcome is only valid on the terminal batch",
      });
    }
    if (value.terminal && value.discoveredCount === undefined) {
      context.addIssue({
        code: "custom",
        path: ["discoveredCount"],
        message: "discoveredCount is required on the terminal batch",
      });
    }
  });

export const FetchRunCommitFailCommandSchema = z.object({
  protocol: FetchRunCommitProtocolSchema,
  command: z.literal("fail"),
  attemptId: z.string().uuid(),
  error: z.string().trim().min(1).max(2_000),
});

/**
 * Public worker-to-server wire contract. Internal stale cleanup deliberately
 * stays outside this schema because it is not an HTTP command.
 */
export const FetchRunCommitWireCommandSchema = z.discriminatedUnion("command", [
  FetchRunCommitStartCommandSchema,
  FetchRunCommitBatchCommandSchema,
  FetchRunCommitFailCommandSchema,
]);

export type FetchRunCommitStartCommand = z.infer<
  typeof FetchRunCommitStartCommandSchema
>;
export type FetchRunCommitBatchCommand = z.infer<
  typeof FetchRunCommitBatchCommandSchema
>;
export type FetchRunCommitFailCommand = z.infer<
  typeof FetchRunCommitFailCommandSchema
>;
