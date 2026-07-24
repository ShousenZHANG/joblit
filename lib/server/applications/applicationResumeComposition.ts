import { escapeLatexWithBold } from "@/lib/server/latex/escapeLatex";
import type { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

type ResumeRenderInput = ReturnType<typeof mapResumeProfile>;

/**
 * Build the only renderable resume representation used by Application flows.
 *
 * The Master Resume Profile remains the document spine. Application aiContent
 * may replace the summary and append accepted bullets, but it cannot silently
 * replace locked profile content such as skills or existing experience bullets.
 */
export function composeApplicationResumeRenderInput(input: {
  master: ResumeRenderInput;
  cv: AiContent["cv"];
}): ResumeRenderInput {
  const proposedSummary =
    input.cv.summary.userEdit?.trim() || input.cv.summary.aiText.trim();
  const acceptedAddedBullets = input.cv.latestExperience.addedBullets
    .filter((bullet) => bullet.accepted)
    .map((bullet) => (bullet.userEdit?.trim() || bullet.text).trim())
    .filter(Boolean)
    .map(escapeLatexWithBold);

  const experienceIndex = input.cv.latestExperience.experienceIndex;
  const targetExperience = input.master.experiences[experienceIndex];
  const experiences = targetExperience
    ? input.master.experiences.map((experience, index) =>
        index === experienceIndex
          ? {
              ...experience,
              bullets: [...experience.bullets, ...acceptedAddedBullets],
            }
          : experience,
      )
    : input.master.experiences;

  return {
    ...input.master,
    summary: proposedSummary
      ? escapeLatexWithBold(proposedSummary)
      : input.master.summary,
    experiences,
    skills: input.master.skills,
  };
}
