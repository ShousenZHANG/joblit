import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import type {
  AiAddedBullet,
  AiContent,
  AiCoverParagraph,
  AiSummary,
} from "@/lib/shared/schemas/aiContent";

function mergeEditableText<T extends AiSummary | AiCoverParagraph>(
  canonical: T,
  submitted: T,
): T {
  const { userEdit: _ignored, ...serverOwned } = canonical;
  return {
    ...serverOwned,
    accepted: submitted.accepted,
    ...(submitted.userEdit === undefined
      ? {}
      : { userEdit: submitted.userEdit }),
  } as T;
}

function mergeEditableBullet(
  canonical: AiAddedBullet,
  submitted: AiAddedBullet | undefined,
): AiAddedBullet {
  if (!submitted) return canonical;
  const { userEdit: _ignored, ...serverOwned } = canonical;
  return {
    ...serverOwned,
    accepted: submitted.accepted,
    ...(submitted.userEdit === undefined
      ? {}
      : { userEdit: submitted.userEdit }),
  };
}

/**
 * Treat the browser payload as an edit command, never as a provenance
 * snapshot. Model output, evidence, review results, hashes and source metadata
 * always remain server-owned.
 */
export function mergeClientAiContentEdits(
  canonical: AiContent,
  submitted: AiContent,
): AiContent {
  return {
    ...canonical,
    cv: {
      ...canonical.cv,
      summary: mergeEditableText(
        canonical.cv.summary,
        submitted.cv.summary,
      ),
      latestExperience: {
        ...canonical.cv.latestExperience,
        addedBullets:
          canonical.cv.latestExperience.addedBullets.map((bullet, index) =>
            mergeEditableBullet(
              bullet,
              submitted.cv.latestExperience.addedBullets[index],
            ),
          ),
      },
      skillsAdditions: canonical.cv.skillsAdditions.map((group, index) => ({
        ...group,
        accepted:
          submitted.cv.skillsAdditions[index]?.accepted ?? group.accepted,
      })),
    },
    cover: {
      paragraphOne: mergeEditableText(
        canonical.cover.paragraphOne,
        submitted.cover.paragraphOne,
      ),
      paragraphTwo: mergeEditableText(
        canonical.cover.paragraphTwo,
        submitted.cover.paragraphTwo,
      ),
      paragraphThree: mergeEditableText(
        canonical.cover.paragraphThree,
        submitted.cover.paragraphThree,
      ),
    },
  };
}

export function rebuildCanonicalAiContent(input: {
  canonical: AiContent;
  submitted?: AiContent;
  resumeSnapshot: unknown;
  jobDescription: string | null | undefined;
  scopeKey: string;
  preserveReviewedAt?: boolean;
}): AiContent {
  const edited = input.submitted
    ? mergeClientAiContentEdits(input.canonical, input.submitted)
    : input.canonical;
  const rebuilt = attachEvidenceAndReview({
    aiContent: edited,
    resumeSnapshot: input.resumeSnapshot,
    jobDescription: input.jobDescription,
    scopeKey: input.scopeKey,
  });

  if (
    input.preserveReviewedAt &&
    rebuilt.review &&
    input.canonical.review?.reviewedAt
  ) {
    return {
      ...rebuilt,
      review: {
        ...rebuilt.review,
        reviewedAt: input.canonical.review.reviewedAt,
      },
    };
  }
  return rebuilt;
}
