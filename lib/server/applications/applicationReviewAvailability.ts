import { aiContentSchema } from "@/lib/shared/schemas/aiContent";

/**
 * Project the Application identity exposed by list and batch read models.
 *
 * A historical PDF remains a valid download even when its Application predates
 * AI Content. It is not, however, a valid entry point to the tailoring editor.
 * Keeping this distinction at the server projection prevents clients from
 * replacing a working PDF link with a Review action that can only fail.
 * The review-snapshot endpoint remains the final authority for ownership,
 * active-run fencing, Profile availability, and the full editor bootstrap.
 */
export function getApplicationReviewId(input: {
  id: string | null | undefined;
  aiContent: unknown;
}): string | null {
  if (!input.id) return null;
  return aiContentSchema.safeParse(input.aiContent).success ? input.id : null;
}
