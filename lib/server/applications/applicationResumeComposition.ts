import { escapeLatexWithBold } from "@/lib/server/latex/escapeLatex";
import type { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { proposalText, resolveSkillsSelection } from "@/lib/shared/aiContentText";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

type ResumeRenderInput = ReturnType<typeof mapResumeProfile>;

/**
 * Build the only renderable resume representation used by Application flows.
 *
 * The Master Resume Profile remains the document spine. Tailoring may replace
 * the summary and narrow or reorder the skills, and nothing else: experience
 * bullets, projects and education render exactly as the candidate wrote them.
 *
 * The skills it renders are still the master profile's own strings — the
 * selection carries indexes, so resolving it can only drop or reorder groups,
 * never introduce a skill that is not already on the profile.
 */
export function composeApplicationResumeRenderInput(input: {
  master: ResumeRenderInput;
  cv: AiContent["cv"];
}): ResumeRenderInput {
  const proposedSummary = proposalText(input.cv.summary);

  return {
    ...input.master,
    summary: proposedSummary
      ? escapeLatexWithBold(proposedSummary)
      : input.master.summary,
    skills: resolveSkillsSelection(input.master.skills, input.cv.skillsSelection),
  };
}
