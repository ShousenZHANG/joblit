import { createHash } from "node:crypto";

import type { TailoringRunTarget } from "@/lib/server/tailoringRuns/tailoringRunProtocol";

export const APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION = 2 as const;
export const LEGACY_APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION = 1 as const;
export type ApplicationBatchTailoringProtocolVersion = 1 | 2;

export const APPLICATION_BATCH_TARGETS = ["RESUME", "COVER"] as const satisfies
  readonly TailoringRunTarget[];

/**
 * Public, deterministic idempotency key for one batch task.
 *
 * The UUID is derived from the Joblit task UUID, not from a private executor
 * run/session identity. Both Codex and the server adapter therefore converge
 * on the same TailoringRun when a response is lost or a stale task is
 * reclaimed.
 */
export function applicationBatchTailoringIssueKey(taskId: string): string {
  const bytes = createHash("sha256")
    .update("joblit:application-batch-tailoring:v1\0")
    .update(taskId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function applicationBatchTargetsFromMask(
  mask: number,
): TailoringRunTarget[] {
  return APPLICATION_BATCH_TARGETS.filter((target) =>
    target === "RESUME" ? (mask & 1) !== 0 : (mask & 2) !== 0,
  );
}

export function applicationBatchTargetProgress(input: {
  requiredTargetMask?: number | null;
  acceptedTargetMask?: number | null;
  publicationRequiredTargetMask?: number | null;
  publishedTargetMask?: number | null;
}): {
  acceptedTargets: TailoringRunTarget[];
  remainingTargets: TailoringRunTarget[];
  publishedTargets: TailoringRunTarget[];
  remainingPublicationTargets: TailoringRunTarget[];
} {
  const requiredTargetMask = input.requiredTargetMask ?? 3;
  const acceptedTargetMask =
    (input.acceptedTargetMask ?? 0) & requiredTargetMask;
  const publicationRequiredTargetMask =
    (input.publicationRequiredTargetMask ?? 0) & requiredTargetMask;
  const publishedTargetMask =
    (input.publishedTargetMask ?? 0) & publicationRequiredTargetMask;
  return {
    acceptedTargets: applicationBatchTargetsFromMask(acceptedTargetMask),
    remainingTargets: applicationBatchTargetsFromMask(
      requiredTargetMask & ~acceptedTargetMask,
    ),
    publishedTargets: applicationBatchTargetsFromMask(publishedTargetMask),
    remainingPublicationTargets: applicationBatchTargetsFromMask(
      acceptedTargetMask & publicationRequiredTargetMask & ~publishedTargetMask,
    ),
  };
}
