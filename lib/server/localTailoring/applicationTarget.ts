import type { Prisma } from "@/lib/generated/prisma";
import { buildPromptSnapshotHash } from "@/lib/server/ai/promptContract";

export const APPLICATION_TARGET_SELECT = {
  aiContent: true, resumePublishedHash: true, coverPublishedHash: true,
  resumePdfUrl: true, coverPdfUrl: true,
} satisfies Prisma.ApplicationSelect;

/** A cover completion must not invalidate a running resume generation (or
 * vice versa). Only the target being replaced participates in this CAS. */
export function applicationTargetHash(row: {
  aiContent: unknown; resumePublishedHash: string | null; coverPublishedHash: string | null;
  resumePdfUrl: string | null; coverPdfUrl: string | null;
} | null, target: string): string {
  const content = row?.aiContent && typeof row.aiContent === "object" && !Array.isArray(row.aiContent)
    ? row.aiContent as Record<string, unknown> : {};
  return buildPromptSnapshotHash({
    content: content[target === "resume" ? "cv" : "cover"] ?? null,
    publishedHash: (target === "resume" ? row?.resumePublishedHash : row?.coverPublishedHash) ?? null,
    url: (target === "resume" ? row?.resumePdfUrl : row?.coverPdfUrl) ?? null,
  });
}
