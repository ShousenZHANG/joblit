import type { AiContent } from "@/lib/shared/schemas/aiContent";

export type AiContentTarget = "resume" | "cover";

/**
 * Merge one newly generated artifact into an existing Application snapshot.
 *
 * `manual-generate` produces a complete AiContent object whose non-target
 * section contains empty defaults. Persisting that object directly would
 * erase the previously reviewed CV or cover letter. Generation metadata stays
 * attached to the newest import while the untouched artifact is preserved.
 */
export function mergeAiContentForTarget(
  existing: AiContent | null,
  incoming: AiContent,
  target: AiContentTarget,
): AiContent {
  if (!existing) return incoming;

  return {
    ...incoming,
    cv: target === "resume" ? incoming.cv : existing.cv,
    cover: target === "cover" ? incoming.cover : existing.cover,
  };
}
