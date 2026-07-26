import {
  TAILORING_RUN_PROTOCOL,
  type TailoringRunHandle,
} from "@/lib/shared/tailoringRunContract";

export { TAILORING_RUN_PROTOCOL, type TailoringRunHandle };

export const TAILORING_RUN_TERMINAL_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIAL",
] as const;

export type TailoringRunStatus =
  | "ISSUED"
  | "RUNNING"
  | (typeof TAILORING_RUN_TERMINAL_STATUSES)[number];

export type TailoringRunSource =
  | "MANUAL_IMPORT"
  | "LOCAL_AI"
  | "CODEX_BATCH"
  | "SERVER_BATCH";

export type TailoringRunDelivery = "DRAFT" | "FINAL";
export type TailoringRunTarget = "RESUME" | "COVER";

export type TailoringRunErrorCode =
  | "RUN_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "JOB_MISMATCH"
  | "RESUME_PROFILE_NOT_FOUND"
  | "PROFILE_MISMATCH"
  | "ISSUE_KEY_CONFLICT"
  | "RUN_ALREADY_TERMINAL"
  | "INVALID_STATE"
  | "INVALID_ATTEMPT_ID"
  | "ATTEMPT_ACTIVE"
  | "ATTEMPT_STALE"
  | "BATCH_TASK_NOT_FOUND"
  | "BATCH_TASK_NOT_RUNNING"
  | "BATCH_ATTEMPT_MISMATCH"
  | "BATCH_PROTOCOL_MISMATCH"
  | "PROMPT_CONFLICT"
  | "INVALID_PROMPT_RECEIPT"
  | "PROMPT_NOT_BOUND"
  | "RECEIPT_CONFLICT"
  | "TARGET_ALREADY_ACCEPTED"
  | "SOURCE_MISMATCH"
  | "DELIVERY_MISMATCH"
  | "TARGET_NOT_REQUIRED"
  | "PROMPT_HASH_MISMATCH"
  | "SNAPSHOT_MISMATCH";

const ERROR_STATUS: Record<TailoringRunErrorCode, number> = {
  RUN_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  JOB_MISMATCH: 409,
  RESUME_PROFILE_NOT_FOUND: 404,
  PROFILE_MISMATCH: 409,
  ISSUE_KEY_CONFLICT: 409,
  RUN_ALREADY_TERMINAL: 409,
  INVALID_STATE: 409,
  INVALID_ATTEMPT_ID: 400,
  ATTEMPT_ACTIVE: 409,
  ATTEMPT_STALE: 409,
  BATCH_TASK_NOT_FOUND: 404,
  BATCH_TASK_NOT_RUNNING: 409,
  BATCH_ATTEMPT_MISMATCH: 409,
  BATCH_PROTOCOL_MISMATCH: 409,
  PROMPT_CONFLICT: 409,
  INVALID_PROMPT_RECEIPT: 400,
  PROMPT_NOT_BOUND: 409,
  RECEIPT_CONFLICT: 409,
  TARGET_ALREADY_ACCEPTED: 409,
  SOURCE_MISMATCH: 409,
  DELIVERY_MISMATCH: 409,
  TARGET_NOT_REQUIRED: 409,
  PROMPT_HASH_MISMATCH: 409,
  SNAPSHOT_MISMATCH: 409,
};

export class TailoringRunError extends Error {
  readonly status: number;

  constructor(
    readonly code: TailoringRunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TailoringRunError";
    this.status = ERROR_STATUS[code];
  }
}

export function isTailoringRunTerminal(
  status: TailoringRunStatus,
): boolean {
  return (TAILORING_RUN_TERMINAL_STATUSES as readonly string[]).includes(
    status,
  );
}

export function requiredTargetMask(
  targets: readonly TailoringRunTarget[],
): number {
  return targets.reduce((mask, target) => {
    return mask | (target === "RESUME" ? 1 : 2);
  }, 0);
}

export function targetMask(target: TailoringRunTarget): number {
  return target === "RESUME" ? 1 : 2;
}
