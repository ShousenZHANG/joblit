import { z } from "zod";

/**
 * Public HTTP contract spoken by unattended Agent Runners.
 *
 * Keep this numeric version aligned with the version returned on a claimed
 * Application Batch task. A Runner must echo that exact value when requesting
 * a task-bound prompt, so an incompatible client fails before prompt issuance.
 */
export const AGENT_EXECUTION_PROTOCOL_VERSION = 1 as const;

const PromptIdentitySchema = z.object({
  jobId: z.string().uuid(),
});

const ManualPromptRequestSchema = PromptIdentitySchema.extend({
  target: z.enum(["resume", "cover"]),
  source: z.literal("manual_import").optional().default("manual_import"),
  delivery: z.enum(["DRAFT", "FINAL"]).optional().default("DRAFT"),
  issueKey: z.string().uuid().optional(),
}).strict();

const CodexBatchPromptRequestSchema = PromptIdentitySchema.extend({
  target: z.enum(["resume", "cover"]),
  source: z.literal("codex_batch"),
  delivery: z.literal("FINAL"),
  protocolVersion: z.literal(AGENT_EXECUTION_PROTOCOL_VERSION),
  issueKey: z.string().uuid(),
  batchId: z.string().uuid(),
  batchTaskId: z.string().uuid(),
  batchAttemptId: z.string().uuid(),
}).strict();

export const AgentApplicationPromptRequestSchema = z.union([
  CodexBatchPromptRequestSchema,
  ManualPromptRequestSchema,
]);
