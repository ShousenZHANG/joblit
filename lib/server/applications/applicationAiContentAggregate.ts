import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import type {
  AiAddedBullet,
  AiContent,
  AiCoverParagraph,
  AiGenerationProvenance,
  AiSummary,
} from "@/lib/shared/schemas/aiContent";

export type ApplicationAiContentTarget = "resume" | "cover";

export type ApplicationAiContentReviewContext = {
  scopeKey: string;
  resumeSnapshot: unknown;
  jobDescription: string | null | undefined;
  /**
   * Distinguishes an owned Job whose description is empty from a missing or
   * foreign Job. Existing job evidence must never be silently rebuilt against
   * an absent source.
   */
  jobSourceAvailable: boolean;
};

type ReplaceTargetProposalCommand = {
  kind: "replace_target_proposal";
  target: ApplicationAiContentTarget;
  proposal: AiContent;
};

type ExistingContentCommand =
  | { kind: "apply_client_edits"; submitted: AiContent }
  | { kind: "refresh_review"; preserveReviewedAt?: boolean }
  | { kind: "discard_edits" };

export type EvolveApplicationAiContentInput =
  | {
      current: AiContent | null;
      command: ReplaceTargetProposalCommand;
      reviewContext: ApplicationAiContentReviewContext;
    }
  | {
      current: AiContent;
      command: ExistingContentCommand;
      reviewContext?: ApplicationAiContentReviewContext;
    };

export type EvolveApplicationAiContentResult =
  | { kind: "evolved"; aiContent: AiContent }
  | { kind: "review_context_required" };

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

function mergeClientEdits(
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

function generationProvenance(
  proposal: AiContent,
  target: ApplicationAiContentTarget,
): AiGenerationProvenance | undefined {
  const targetProvenance = proposal.provenance?.[target];
  if (targetProvenance) return targetProvenance;
  if (!proposal.source) return undefined;
  return {
    generatedAt: proposal.generatedAt,
    promptMetaHash: proposal.promptMetaHash,
    source: proposal.source,
  };
}

function replaceTargetProposal(
  current: AiContent | null,
  proposal: AiContent,
  target: ApplicationAiContentTarget,
): AiContent {
  const replacementProvenance = generationProvenance(proposal, target);
  return {
    ...proposal,
    cv: target === "resume" || !current ? proposal.cv : current.cv,
    cover:
      target === "cover" || !current ? proposal.cover : current.cover,
    provenance: {
      ...(target === "resume"
        ? replacementProvenance
          ? { resume: replacementProvenance }
          : {}
        : current?.provenance?.resume
          ? { resume: current.provenance.resume }
          : {}),
      ...(target === "cover"
        ? replacementProvenance
          ? { cover: replacementProvenance }
          : {}
        : current?.provenance?.cover
          ? { cover: current.provenance.cover }
          : {}),
    },
  };
}

function resetToOriginalProposal(content: AiContent): AiContent {
  return {
    ...content,
    cv: {
      summary: {
        aiText: content.cv.summary.aiText,
        originalText: content.cv.summary.originalText,
        accepted: true,
      },
      latestExperience: {
        experienceIndex: content.cv.latestExperience.experienceIndex,
        addedBullets: content.cv.latestExperience.addedBullets.map((bullet) => ({
          text: bullet.text,
          accepted: bullet.qualityGate?.passed ?? true,
          ...(bullet.qualityGate
            ? { qualityGate: bullet.qualityGate }
            : {}),
        })),
      },
    },
    cover: {
      paragraphOne: {
        aiText: content.cover.paragraphOne.aiText,
        accepted: true,
      },
      paragraphTwo: {
        aiText: content.cover.paragraphTwo.aiText,
        accepted: true,
      },
      paragraphThree: {
        aiText: content.cover.paragraphThree.aiText,
        accepted: true,
      },
    },
  };
}

function hasCanonicalReviewMetadata(content: AiContent): boolean {
  return Boolean(
    content.evidence !== undefined ||
      content.review !== undefined ||
      content.cv.summary.evidenceIds?.length ||
      content.cv.latestExperience.addedBullets.some(
        (bullet) => Boolean(bullet.evidenceIds?.length),
      ) ||
      content.cover.paragraphOne.evidenceIds?.length ||
      content.cover.paragraphTwo.evidenceIds?.length ||
      content.cover.paragraphThree.evidenceIds?.length,
  );
}

function reviewInputsUnchanged(
  before: AiContent,
  after: AiContent,
): boolean {
  if (!before.review || !after.review) return false;
  const { reviewedAt: _beforeReviewedAt, ...beforeReview } = before.review;
  const { reviewedAt: _afterReviewedAt, ...afterReview } = after.review;
  return (
    JSON.stringify(before.evidence ?? []) ===
      JSON.stringify(after.evidence ?? []) &&
    JSON.stringify(beforeReview) === JSON.stringify(afterReview) &&
    JSON.stringify(claimEvidenceAssignments(before)) ===
      JSON.stringify(claimEvidenceAssignments(after))
  );
}

function claimEvidenceAssignments(content: AiContent): string[][] {
  return [
    content.cv.summary.evidenceIds ?? [],
    ...content.cv.latestExperience.addedBullets.map(
      (bullet) => bullet.evidenceIds ?? [],
    ),
    content.cover.paragraphOne.evidenceIds ?? [],
    content.cover.paragraphTwo.evidenceIds ?? [],
    content.cover.paragraphThree.evidenceIds ?? [],
  ];
}

/**
 * Evolve the server-owned AI Content aggregate through one interface.
 *
 * The implementation owns target preservation, per-target provenance,
 * browser-edit filtering, discard semantics, evidence refresh and review
 * ordering. Callers state an intent and provide canonical source facts; they
 * never sequence merge -> review -> hash themselves.
 */
export function evolveApplicationAiContent(
  input: EvolveApplicationAiContentInput,
): EvolveApplicationAiContentResult {
  const command = input.command;
  let changed: AiContent;
  let reviewBasis: AiContent;

  if (command.kind === "replace_target_proposal") {
    changed = replaceTargetProposal(
      input.current,
      command.proposal,
      command.target,
    );
    reviewBasis = input.current ?? changed;
  } else {
    // The input union requires current content for every non-proposal command.
    // Keep the runtime assertion so an untyped JavaScript caller also fails
    // closed instead of manufacturing an invalid aggregate.
    if (!input.current) {
      throw new Error("APPLICATION_AI_CONTENT_CURRENT_REQUIRED");
    }
    reviewBasis = input.current;
    changed =
      command.kind === "apply_client_edits"
        ? mergeClientEdits(input.current, command.submitted)
        : command.kind === "discard_edits"
          ? resetToOriginalProposal(input.current)
          : input.current;
  }

  const reviewRequired =
    command.kind === "replace_target_proposal" ||
    command.kind === "refresh_review" ||
    input.reviewContext !== undefined ||
    hasCanonicalReviewMetadata(reviewBasis);
  if (!reviewRequired) return { kind: "evolved", aiContent: changed };

  const context = input.reviewContext;
  if (!context || !context.jobSourceAvailable) {
    return { kind: "review_context_required" };
  }

  const rebuilt = attachEvidenceAndReview({
    aiContent: changed,
    resumeSnapshot: context.resumeSnapshot,
    jobDescription: context.jobDescription,
    scopeKey: context.scopeKey,
  });

  if (
    command.kind === "refresh_review" &&
    command.preserveReviewedAt &&
    rebuilt.review &&
    reviewBasis.review?.reviewedAt &&
    reviewInputsUnchanged(reviewBasis, rebuilt)
  ) {
    return {
      kind: "evolved",
      aiContent: {
        ...rebuilt,
        review: {
          ...rebuilt.review,
          reviewedAt: reviewBasis.review.reviewedAt,
        },
      },
    };
  }

  return { kind: "evolved", aiContent: rebuilt };
}
