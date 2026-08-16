import { buildCoverEvidenceContext } from "@/lib/server/ai/coverContext";
import { evaluateCoverQuality } from "@/lib/server/ai/coverQuality";
import {
  lintGeneratedSummary,
  profileTextForLint,
  type SummaryLintFailure,
} from "@/lib/server/ai/summaryLint";
import { getLocaleProfile } from "@/lib/shared/locales";
import type { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import type { SkillsSelection } from "@/lib/shared/schemas/applicationGenerationOutput";
import {
  masterSkillGroups,
  parseCoverManualOutput,
  parseCoverStrictOutput,
  parseResumeManualOutput,
  parseResumeStrictOutput,
  validateSkillsSelectionBounds,
  type SkillsSelectionBoundsFailure,
} from "./manualImportParser";

export type ApplicationGenerationTarget = "resume" | "cover";
export type ApplicationGenerationSource =
  | "manual_import"
  | "codex_batch"
  | "server_batch";
type ResumeRenderInput = ReturnType<typeof mapResumeProfile>;

type ApplicationGenerationError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

type AcceptedApplicationGeneration = {
  ok: true;
  target: ApplicationGenerationTarget;
  aiContent: AiContent;
  coverQualityGate: "pass" | "soft-fail";
  coverQualityIssueCount: number;
};

type RejectedApplicationGeneration = {
  ok: false;
  error: ApplicationGenerationError;
};

export type ApplicationGenerationAcceptance =
  | AcceptedApplicationGeneration
  | RejectedApplicationGeneration;

export type AcceptApplicationGenerationInput = {
  target: ApplicationGenerationTarget;
  source: ApplicationGenerationSource;
  rawOutput: string;
  promptMetaHash: string;
  master: ResumeRenderInput;
  profile: Record<string, unknown>;
  job: {
    title: string;
    company: string | null;
    description: string | null;
  };
};

type DecodedCoverOutput = {
  ok: true;
  data: NonNullable<ReturnType<typeof parseCoverManualOutput>["data"]>;
};

type GenerationMetadata = Pick<
  AiContent,
  "schemaVersion" | "generatedAt" | "promptMetaHash"
> &
  Partial<Pick<AiContent, "source" | "provenance">>;

function emptyCoverParagraph() {
  return { aiText: "", accepted: false };
}

function emptyCover(): AiContent["cover"] {
  return {
    paragraphOne: emptyCoverParagraph(),
    paragraphTwo: emptyCoverParagraph(),
    paragraphThree: emptyCoverParagraph(),
  };
}

function generationSourceLabel(source: ApplicationGenerationSource): string {
  if (source === "codex_batch") return "Codex Batch";
  return "Internal AI";
}

function invalidOutputMessage(
  source: ApplicationGenerationSource,
  target: ApplicationGenerationTarget,
): string {
  if (source !== "manual_import") {
    const artifact = target === "resume" ? "resume" : "cover-letter";
    return `${generationSourceLabel(source)} returned invalid ${artifact} JSON.`;
  }
  if (target === "resume") {
    return "Unable to parse model output. Resume JSON must include cvSummary and skillsSelection.";
  }
  return "Unable to parse model output. Cover JSON must include cover.paragraphOne/paragraphTwo/paragraphThree.";
}

function rejectInvalidOutput(
  source: ApplicationGenerationSource,
  target: ApplicationGenerationTarget,
  details: string[],
): RejectedApplicationGeneration {
  const strictSource = source !== "manual_import";
  return {
    ok: false,
    error: {
      status: 400,
      code: strictSource ? "INVALID_AI_RESULT" : "PARSE_FAILED",
      message: invalidOutputMessage(source, target),
      details: details.slice(0, 8),
    },
  };
}

/**
 * A selection index that addresses nothing. The model was handed a numbered
 * skill bank, so this means it either invented an index or answered against a
 * profile the user has since edited; both are deterministic failures.
 */
function rejectSkillsSelection(
  failure: SkillsSelectionBoundsFailure,
): RejectedApplicationGeneration {
  const where =
    failure.kind === "group_out_of_range"
      ? `skill group ${failure.group}`
      : `item ${failure.item} of skill group ${failure.group}`;
  return {
    ok: false,
    error: {
      status: 400,
      code: "SKILLS_SELECTION_INVALID",
      message: `The selection refers to ${where}, which is not in your skills. Re-copy the prompt and try again.`,
    },
  };
}

function rejectSummary(
  failure: SummaryLintFailure,
): RejectedApplicationGeneration {
  const rejection = {
    title_missing: {
      code: "SUMMARY_TITLE_MISSING",
      message:
        failure.kind === "title_missing"
          ? `The summary must name the target role ("${failure.requiredTitle}").`
          : "",
    },
    ungrounded_number: {
      code: "SUMMARY_UNGROUNDED_NUMBER",
      message:
        failure.kind === "ungrounded_number"
          ? `The summary claims "${failure.token}", which does not appear anywhere in your profile.`
          : "",
    },
    ungrounded_skill: {
      code: "SUMMARY_UNGROUNDED_SKILL",
      message:
        failure.kind === "ungrounded_skill"
          ? `The summary claims "${failure.skill}", which is not in your profile. Add it in the Resume Studio or edit the summary.`
          : "",
    },
  }[failure.kind];

  return {
    ok: false,
    error: { status: 422, ...rejection },
  };
}

function buildGenerationMetadata(
  input: AcceptApplicationGenerationInput,
  target: ApplicationGenerationTarget,
  generatedAt: string,
): GenerationMetadata {
  const source =
    input.source === "server_batch" ? {} : { source: input.source };
  if (!input.promptMetaHash) {
    return {
      schemaVersion: AI_CONTENT_SCHEMA_VERSION,
      generatedAt,
      promptMetaHash: input.promptMetaHash,
      ...source,
    };
  }
  const targetProvenance = {
    generatedAt,
    promptMetaHash: input.promptMetaHash,
    source: input.source,
  };
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt,
    promptMetaHash: input.promptMetaHash,
    ...source,
    provenance:
      target === "resume"
        ? { resume: targetProvenance }
        : { cover: targetProvenance },
  };
}

function buildResumeAiContent(
  input: AcceptApplicationGenerationInput,
  cvSummary: string,
  skillsSelection: SkillsSelection,
): AiContent {
  const generatedAt = new Date().toISOString();
  return {
    ...buildGenerationMetadata(input, "resume", generatedAt),
    cv: {
      summary: {
        aiText: cvSummary.trim(),
        originalText: input.master.summary ?? "",
        accepted: true,
      },
      skillsSelection: { aiSelection: skillsSelection },
    },
    cover: emptyCover(),
  };
}

function acceptResumeGeneration(
  input: AcceptApplicationGenerationInput,
): ApplicationGenerationAcceptance {
  const parsed =
    input.source === "manual_import"
      ? parseResumeManualOutput(input.rawOutput)
      : parseResumeStrictOutput(input.rawOutput);
  if (!parsed.data) {
    return rejectInvalidOutput(input.source, "resume", parsed.issues);
  }

  const bounds = validateSkillsSelectionBounds(
    parsed.data.skillsSelection,
    masterSkillGroups(input.profile),
  );
  if (bounds) return rejectSkillsSelection(bounds);

  const lint = lintGeneratedSummary({
    summary: parsed.data.cvSummary,
    jobTitle: input.job.title,
    profileText: profileTextForLint(input.profile),
  });
  if (!lint.ok) return rejectSummary(lint.failure);

  return {
    ok: true,
    target: "resume",
    aiContent: buildResumeAiContent(
      input,
      parsed.data.cvSummary,
      parsed.data.skillsSelection,
    ),
    coverQualityGate: "pass",
    coverQualityIssueCount: 0,
  };
}

function decodeCoverOutput(
  input: AcceptApplicationGenerationInput,
): DecodedCoverOutput | RejectedApplicationGeneration {
  const parsed =
    input.source === "manual_import"
      ? parseCoverManualOutput(input.rawOutput)
      : parseCoverStrictOutput(input.rawOutput);
  if (!parsed.data) {
    return rejectInvalidOutput(input.source, "cover", parsed.issues);
  }
  return { ok: true, data: parsed.data };
}

function evaluateGeneratedCover(
  input: AcceptApplicationGenerationInput,
  cover: DecodedCoverOutput["data"]["cover"],
): ReturnType<typeof evaluateCoverQuality> {
  const profileSummary =
    typeof input.profile.summary === "string" &&
    input.profile.summary.trim().length > 0
      ? input.profile.summary
      : input.master.summary;
  const coverContext = buildCoverEvidenceContext({
    baseSummary: profileSummary,
    description: input.job.description || "",
    resumeSnapshot: input.profile,
  });
  const locale =
    input.profile.locale === "zh-CN" ? "zh-CN" : "en-AU";
  return evaluateCoverQuality({
    draft: {
      paragraphOne: cover.paragraphOne,
      paragraphTwo: cover.paragraphTwo,
      paragraphThree: cover.paragraphThree,
    },
    context: coverContext,
    company: input.job.company || "the company",
    targetWordRange: getLocaleProfile(locale).coverWordRange,
    localeProfile: locale,
  });
}

function buildCoverAiContent(
  input: AcceptApplicationGenerationInput,
  cover: DecodedCoverOutput["data"]["cover"],
): AiContent {
  const generatedAt = new Date().toISOString();
  return {
    ...buildGenerationMetadata(input, "cover", generatedAt),
    cv: {
      summary: {
        aiText: "",
        originalText: input.master.summary ?? "",
        accepted: false,
      },
    },
    cover: {
      paragraphOne: { aiText: cover.paragraphOne, accepted: true },
      paragraphTwo: { aiText: cover.paragraphTwo, accepted: true },
      paragraphThree: { aiText: cover.paragraphThree, accepted: true },
    },
  };
}

function acceptCoverGeneration(
  input: AcceptApplicationGenerationInput,
): ApplicationGenerationAcceptance {
  const decoded = decodeCoverOutput(input);
  if (!decoded.ok) return decoded;

  const qualityReport = evaluateGeneratedCover(input, decoded.data.cover);
  return {
    ok: true,
    target: "cover",
    aiContent: buildCoverAiContent(input, decoded.data.cover),
    coverQualityGate: qualityReport.passed ? "pass" : "soft-fail",
    coverQualityIssueCount: qualityReport.issues.length,
  };
}

export function acceptApplicationGeneration(
  input: AcceptApplicationGenerationInput,
): ApplicationGenerationAcceptance {
  if (input.target === "resume") {
    return acceptResumeGeneration(input);
  }
  return acceptCoverGeneration(input);
}
