import { buildCoverEvidenceContext } from "@/lib/server/ai/coverContext";
import { evaluateCoverQuality } from "@/lib/server/ai/coverQuality";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { getLocaleProfile } from "@/lib/shared/locales";
import type { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiAddedBullet,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import {
  canonicalizeLatestBullets,
  getLatestRawBullets,
  isGroundedAddedBullet,
  isNonRedundantAddedBullet,
  parseCoverManualOutput,
  parseCoverStrictOutput,
  parseResumeManualOutput,
  parseResumeStrictOutput,
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
  inputFormat: "current" | "v1_compat";
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
  evidenceScopeKey: string;
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

type DecodedResumeOutput = {
  ok: true;
  data: NonNullable<ReturnType<typeof parseResumeManualOutput>["data"]>;
  inputFormat: AcceptedApplicationGeneration["inputFormat"];
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
    return "Unable to parse model output. Resume JSON must include cvSummary and latestExperience.addedBullets.";
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

function joinEvidence(parts: Array<string | undefined>): string {
  return parts
    .filter((item): item is string => Boolean(item))
    .join(" ");
}

function collectCandidateEvidence(
  profile: Record<string, unknown>,
  baseLatestBullets: string[],
): string[] {
  const snapshot = buildResumePromptSnapshot(profile);
  const evidence = [
    ...baseLatestBullets,
    snapshot.summary,
    ...(snapshot.skills ?? []).map((group) =>
      joinEvidence([group.category, ...group.items]),
    ),
    ...(snapshot.experiences ?? []).map((experience) =>
      joinEvidence([
        experience.title,
        experience.company,
        ...experience.bullets,
      ]),
    ),
    ...(snapshot.projects ?? []).map((project) =>
      joinEvidence([project.name, project.stack, ...project.bullets]),
    ),
    ...(snapshot.education ?? []).map((education) =>
      joinEvidence([education.school, education.degree, education.details]),
    ),
  ];
  return evidence
    .filter((item): item is string => Boolean(item))
    .map((item) => item.trim())
    .filter(Boolean);
}

function decodeResumeOutput(
  input: AcceptApplicationGenerationInput,
): DecodedResumeOutput | RejectedApplicationGeneration {
  const parsed =
    input.source === "manual_import"
      ? parseResumeManualOutput(input.rawOutput)
      : parseResumeStrictOutput(input.rawOutput);
  if (!parsed.data) {
    return rejectInvalidOutput(input.source, "resume", parsed.issues);
  }
  return {
    ok: true,
    data: parsed.data,
    inputFormat:
      "addedBullets" in parsed.data.latestExperience
        ? "current"
        : "v1_compat",
  };
}

function resolveBaseBullets(input: AcceptApplicationGenerationInput): string[] {
  const baseLatestRawBullets = getLatestRawBullets(input.profile);
  if (baseLatestRawBullets.length > 0) return baseLatestRawBullets;
  return (
    input.master.experiences[0]?.bullets
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function extractAddedBulletTexts(
  output: DecodedResumeOutput["data"],
  baseBullets: string[],
): string[] {
  const latestExperience = output.latestExperience;
  if ("addedBullets" in latestExperience) {
    return latestExperience.addedBullets;
  }
  return canonicalizeLatestBullets(
    baseBullets,
    latestExperience.bullets,
  ).addedBullets;
}

function gateAddedBullets(
  addedBulletTexts: string[],
  candidateEvidence: string[],
  baseBullets: string[],
): AiAddedBullet[] {
  const acceptedAddedBullets: string[] = [];
  return addedBulletTexts.map((bullet) => {
    const grounded = isGroundedAddedBullet(bullet, candidateEvidence);
    const nonRedundant = grounded
      ? isNonRedundantAddedBullet(bullet, baseBullets, acceptedAddedBullets)
      : false;
    const passed = grounded && nonRedundant;
    const reason = !grounded
      ? "ungrounded: no Master Resume Profile evidence"
      : !nonRedundant
        ? "redundant: too similar to an existing bullet"
        : undefined;

    if (passed) acceptedAddedBullets.push(bullet);
    return {
      text: bullet,
      accepted: passed,
      qualityGate: { passed, ...(reason ? { reason } : {}) },
    };
  });
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
  addedBullets: AiAddedBullet[],
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
      latestExperience: {
        experienceIndex: 0,
        addedBullets,
      },
    },
    cover: emptyCover(),
  };
}

function tooManyAddedBullets(): RejectedApplicationGeneration {
  return {
    ok: false,
    error: {
      status: 400,
      code: "INVALID_LATEST_EXPERIENCE_BULLETS",
      message: "latestExperience contains more than 3 AI-added bullets.",
    },
  };
}

function acceptResumeGeneration(
  input: AcceptApplicationGenerationInput,
): ApplicationGenerationAcceptance {
  const decoded = decodeResumeOutput(input);
  if (!decoded.ok) return decoded;

  const baseBullets = resolveBaseBullets(input);
  const bulletTexts = extractAddedBulletTexts(decoded.data, baseBullets);
  if (bulletTexts.length > 3) return tooManyAddedBullets();

  const evidence = collectCandidateEvidence(input.profile, baseBullets);
  const addedBullets = gateAddedBullets(bulletTexts, evidence, baseBullets);
  return {
    ok: true,
    target: "resume",
    inputFormat: decoded.inputFormat,
    aiContent: buildResumeAiContent(
      input,
      decoded.data.cvSummary,
      addedBullets,
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
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [],
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
    inputFormat: "current",
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
