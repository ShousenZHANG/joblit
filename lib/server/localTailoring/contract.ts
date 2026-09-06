import { z } from "zod";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";

export const MAX_ATTEMPTS = 3;
export const TASK_LIFETIME_MS = 2 * 60 * 60 * 1000;
export const CLAIM_LIFETIME_MS = 5 * 60 * 1000;
export const ACTIVE_STATUSES = ["pending", "generating", "publishing", "repair"];
export const createTaskSchema = z.object({ jobId: z.string().uuid(), target: z.enum(["resume", "cover"]) }).strict();
export const taskIdSchema = z.object({ id: z.string().uuid() });
export const resultSchema = z.object({ rawOutput: z.string().min(1).max(80_000), attempt: z.number().int().min(1).max(MAX_ATTEMPTS) }).strict();
export const progressSchema = z.object({ phase: z.literal("generating"), attempt: z.number().int().min(1).max(MAX_ATTEMPTS) }).strict();

export type TaskAccess = { userId: string } | { capability: string };
export type CompletedResult = {
  status: "completed";
  applicationId: string;
  aiContentHash: string;
  publication: ApplicationPublication;
  resumePdfUrl: string | null;
  resumePdfName: string | null;
  coverPdfUrl: string | null;
  coverPdfName: string | null;
};
export type AttemptResult = CompletedResult | {
  status: "repair" | "failed";
  code: string;
  message: string;
  attempt: number;
  maxAttempts: number;
  repairInstruction?: string;
} | { status: "publishing"; attempt: number; retryAfterSeconds: number };
