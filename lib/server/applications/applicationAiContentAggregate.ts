import { AppError } from "@/lib/server/api/appError";
import type {
  AiContent,
  AiCoverParagraph,
  AiGenerationProvenance,
  AiSummary,
} from "@/lib/shared/schemas/aiContent";

export type ApplicationAiContentTarget = "resume" | "cover";

type ReplaceTargetProposalCommand = {
  kind: "replace_target_proposal";
  target: ApplicationAiContentTarget;
  proposal: AiContent;
};

type ExistingContentCommand =
  | { kind: "apply_client_edits"; submitted: AiContent }
  | { kind: "discard_edits" };

export type EvolveApplicationAiContentInput =
  | { current: AiContent | null; command: ReplaceTargetProposalCommand }
  | { current: AiContent; command: ExistingContentCommand };

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

/**
 * The browser may narrow or reorder the tailored skills, and nothing else about
 * them: `aiSelection` is the generation's own record and stays server-owned so
 * Discard can restore it.
 *
 * A submitted selection is a list of indexes, so the worst a forged body can do
 * is address a skill that does not exist — `resolveSkillsSelection` drops
 * unresolvable references at render time, and no path turns an index into a
 * string the candidate never wrote.
 */
function mergeEditableSkillsSelection(
  canonical: AiContent["cv"]["skillsSelection"],
  submitted: AiContent["cv"]["skillsSelection"],
): AiContent["cv"]["skillsSelection"] {
  if (!canonical) return undefined;
  return {
    aiSelection: canonical.aiSelection,
    ...(submitted?.userSelection
      ? { userSelection: submitted.userSelection }
      : {}),
  };
}

function mergeClientEdits(
  canonical: AiContent,
  submitted: AiContent,
): AiContent {
  const skillsSelection = mergeEditableSkillsSelection(
    canonical.cv.skillsSelection,
    submitted.cv.skillsSelection,
  );
  return {
    ...canonical,
    cv: {
      summary: mergeEditableText(canonical.cv.summary, submitted.cv.summary),
      ...(skillsSelection ? { skillsSelection } : {}),
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
  return proposal.provenance?.[target];
}

function replaceTargetProposal(
  current: AiContent | null,
  proposal: AiContent,
  target: ApplicationAiContentTarget,
): AiContent {
  const replacementProvenance = generationProvenance(proposal, target);
  const provenance = {
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
  };
  const { provenance: _proposalProvenance, ...proposalWithoutProvenance } =
    proposal;
  return {
    ...proposalWithoutProvenance,
    cv: target === "resume" || !current ? proposal.cv : current.cv,
    cover: target === "cover" || !current ? proposal.cover : current.cover,
    ...(Object.keys(provenance).length > 0 ? { provenance } : {}),
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
      ...(content.cv.skillsSelection
        ? {
            skillsSelection: {
              aiSelection: content.cv.skillsSelection.aiSelection,
            },
          }
        : {}),
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

/**
 * Evolve the server-owned AI Content aggregate through one interface.
 *
 * The implementation owns target preservation, per-target provenance, browser-
 * edit filtering and discard semantics. Callers state an intent and never
 * assemble a new aggregate themselves.
 *
 * There is no review step. Generated content is judged at the import boundary
 * by `lib/server/ai/summaryLint.ts` — a deterministic check the model cannot
 * argue with — and the skills selection can only reference the candidate's own
 * profile, so there is nothing left for a downstream gate to catch.
 */
export function evolveApplicationAiContent(
  input: EvolveApplicationAiContentInput,
): AiContent {
  const command = input.command;

  if (command.kind === "replace_target_proposal") {
    return replaceTargetProposal(input.current, command.proposal, command.target);
  }

  // The input union requires current content for every non-proposal command.
  // Keep the runtime assertion so an untyped JavaScript caller also fails
  // closed instead of manufacturing an invalid aggregate.
  if (!input.current) {
    throw new AppError({
      code: "APPLICATION_AI_CONTENT_CURRENT_REQUIRED",
      status: 409,
      publicMessage:
        "There is no existing draft to apply this change to. Generate this job again.",
    });
  }

  return command.kind === "apply_client_edits"
    ? mergeClientEdits(input.current, command.submitted)
    : resetToOriginalProposal(input.current);
}
