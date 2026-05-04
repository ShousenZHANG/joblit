import { buildTailorPrompts } from "./buildPrompt";
import { getPromptSkillRules } from "./promptSkills";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { parseTailorModelOutput } from "./schema";
import { buildCoverEvidenceContext, type CoverEvidenceContext } from "./coverContext";
import {
  buildCoverQualityRewriteBrief,
  evaluateCoverQuality,
  type CoverDraft,
  type CoverQualityReport,
} from "./coverQuality";
import {
  callProvider,
  getDefaultModel,
  type AiProviderName,
  normalizeProviderModel,
} from "@/lib/server/ai/providers";

type TailorInput = {
  baseSummary: string;
  jobTitle: string;
  company: string;
  description: string;
  resumeSnapshot?: unknown;
  userId?: string;
};

type TailorResult = {
  cvSummary: string;
  cover: {
    candidateTitle?: string;
    subject?: string;
    date?: string;
    salutation?: string;
    paragraphOne: string;
    paragraphTwo: string;
    paragraphThree: string;
    closing?: string;
    signatureName?: string;
  };
  source: {
    cv: "ai" | "base";
    cover: "ai" | "fallback";
  };
  reason:
    | "ai_ok"
    | "missing_api_key"
    | "provider_error"
    | "parse_failed"
    | "quality_gate_failed"
    | "exception";
  qualityReport?: CoverQualityReport;
};

type ParsedModelPayload = {
  cvSummary: string;
  cover: {
    candidateTitle?: string;
    subject?: string;
    date?: string;
    salutation?: string;
    paragraphOne: string;
    paragraphTwo: string;
    paragraphThree: string;
    closing?: string;
    signatureName?: string;
  };
};

type TailorOptions = {
  strictCoverQuality?: boolean;
  maxCoverRewritePasses?: number;
  localeProfile?: "en-AU" | "en-US" | "zh-CN" | "global";
  targetWordRange?: { min: number; max: number };
};

import { truncate } from "@/lib/shared/utils/text";

const DEFAULT_PROVIDER: AiProviderName = "gemini";

function buildFallback(input: TailorInput, reason: TailorResult["reason"]): TailorResult {
  const title = input.jobTitle || "the role";
  const company = input.company || "the company";
  const shortDesc = truncate(input.description.replace(/\s+/g, " ").trim(), 280);
  const baseSummary = input.baseSummary.trim();

  return {
    // Mainstream safe behavior: fallback never mutates user's stored summary.
    cvSummary: baseSummary,
    cover: {
      paragraphOne: `I am applying for the ${title} position at ${company}. The role aligns strongly with my recent engineering experience and the way I approach product delivery.`,
      paragraphTwo: shortDesc
        ? `Based on the job description, I can contribute quickly in the areas that matter most: ${shortDesc}`
        : `I can contribute quickly by combining strong implementation skills, clear communication, and reliable delivery practices.`,
      paragraphThree:
        "I am excited about the opportunity to bring a user-focused, execution-oriented mindset to your team and help ship meaningful outcomes.",
    },
    source: {
      cv: "base",
      cover: "fallback",
    },
    reason,
  };
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text || fallback;
}

function normalizeCoverDraft(cover: ParsedModelPayload["cover"], fallback: TailorResult["cover"]): CoverDraft {
  return {
    candidateTitle: normalizeText(cover.candidateTitle, fallback.candidateTitle || ""),
    subject: normalizeText(cover.subject, fallback.subject || ""),
    date: normalizeText(cover.date, fallback.date || ""),
    salutation: normalizeText(cover.salutation, fallback.salutation || ""),
    paragraphOne: normalizeText(cover.paragraphOne, fallback.paragraphOne),
    paragraphTwo: normalizeText(cover.paragraphTwo, fallback.paragraphTwo),
    paragraphThree: normalizeText(cover.paragraphThree, fallback.paragraphThree),
    closing: normalizeText(cover.closing, fallback.closing || ""),
    signatureName: normalizeText(cover.signatureName, fallback.signatureName || ""),
  };
}

async function callProviderWithFallback(params: {
  provider: AiProviderName;
  apiKey: string;
  normalizedModel: string;
  defaultModel: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  /**
   * Sampling temperature override. Defaults to the provider's own
   * default (0.2). Cover-only rewrite passes bump this to 0.35 so the
   * model has a touch more headroom for tone variation without
   * loosening the resume bullets in the same call.
   */
  temperature?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 12000);
  try {
    try {
      return await callProvider(params.provider, {
        apiKey: params.apiKey,
        model: params.normalizedModel,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        signal: controller.signal,
        temperature: params.temperature,
      });
    } catch (error) {
      if (params.normalizedModel !== params.defaultModel) {
        return await callProvider(params.provider, {
          apiKey: params.apiKey,
          model: params.defaultModel,
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          signal: controller.signal,
          temperature: params.temperature,
        });
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function buildCoverRewritePrompt(input: {
  originalPrompt: string;
  draft: CoverDraft;
  qualityReport: CoverQualityReport;
  context?: CoverEvidenceContext;
  localeProfile: "en-AU" | "en-US" | "zh-CN" | "global";
  targetWordRange: { min: number; max: number };
}) {
  const localeLine =
    input.localeProfile === "en-AU"
      ? "Locale profile: en-AU (Australian market tone: concise, grounded, professional)."
      : input.localeProfile === "en-US"
        ? "Locale profile: en-US (direct, impact-focused, concise)."
        : input.localeProfile === "zh-CN"
          ? "Locale profile: zh-CN (Chinese market tone: concise, grounded, professional Chinese)."
          : "Locale profile: global neutral business English.";
  return [
    input.originalPrompt,
    "",
    "Rewrite pass instructions (run exactly once):",
    localeLine,
    `Target total words for paragraphOne+paragraphTwo+paragraphThree: ${input.targetWordRange.min}-${input.targetWordRange.max}.`,
    buildCoverQualityRewriteBrief(input.qualityReport),
    "",
    "Current draft JSON (rewrite and improve, return final strict JSON only):",
    JSON.stringify({ cover: input.draft }, null, 2),
    "",
    ...(input.context
      ? [
          "Grounding context reminder:",
          `Top responsibilities: ${input.context.topResponsibilities.join(" | ") || "(none)"}`,
          `Matched evidence: ${input.context.matchedEvidence.join(" | ") || "(none)"}`,
        ]
      : []),
  ].join("\n");
}

export async function tailorApplicationContent(
  input: TailorInput,
  options?: TailorOptions,
): Promise<TailorResult> {
  try {
    const strictCoverQuality = options?.strictCoverQuality ?? false;
    const maxCoverRewritePasses = options?.maxCoverRewritePasses ?? 0;
    const localeProfile = options?.localeProfile ?? "global";
    const targetWordRange = options?.targetWordRange ?? { min: 280, max: 360 };

    const skillRules = input.userId
      ? await getActivePromptSkillRulesForUser(input.userId)
      : getPromptSkillRules();
    const defaultProviderConfig = {
      provider: DEFAULT_PROVIDER,
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || getDefaultModel(DEFAULT_PROVIDER),
    };
    const providerConfig = defaultProviderConfig;

    if (!providerConfig.apiKey) {
      return buildFallback(input, "missing_api_key");
    }

    const coverContext = buildCoverEvidenceContext({
      baseSummary: input.baseSummary,
      description: input.description,
      resumeSnapshot: input.resumeSnapshot,
    });
    const { systemPrompt, userPrompt } = buildTailorPrompts(skillRules, {
      ...input,
      coverContext,
    });
    const normalizedModel = normalizeProviderModel(
      providerConfig.provider,
      providerConfig.model,
    );
    const defaultModel = getDefaultModel(providerConfig.provider);

    let content = await callProviderWithFallback({
      provider: providerConfig.provider,
      apiKey: providerConfig.apiKey,
      normalizedModel,
      defaultModel,
      systemPrompt,
      userPrompt,
    });

    const parsedRaw = parseTailorModelOutput(content);
    const parsed: ParsedModelPayload | null = parsedRaw
      ? {
          cvSummary: normalizeText(parsedRaw.cvSummary),
          cover: {
            candidateTitle: normalizeText(parsedRaw.cover.candidateTitle),
            subject: normalizeText(parsedRaw.cover.subject),
            date: normalizeText(parsedRaw.cover.date),
            salutation: normalizeText(parsedRaw.cover.salutation),
            paragraphOne: normalizeText(parsedRaw.cover.paragraphOne),
            paragraphTwo: normalizeText(parsedRaw.cover.paragraphTwo),
            paragraphThree: normalizeText(parsedRaw.cover.paragraphThree),
            closing: normalizeText(parsedRaw.cover.closing),
            signatureName: normalizeText(parsedRaw.cover.signatureName),
          },
        }
      : null;
    if (!parsed) {
      return buildFallback(input, "parse_failed");
    }

    const fallback = buildFallback(input, "ai_ok");
    let finalCover = normalizeCoverDraft(parsed.cover, fallback.cover);
    let qualityReport: CoverQualityReport | undefined;

    if (strictCoverQuality && coverContext) {
      qualityReport = evaluateCoverQuality({
        draft: finalCover,
        context: coverContext,
        company: input.company,
        targetWordRange,
      });

      if (!qualityReport.passed && maxCoverRewritePasses > 0) {
        const rewritePrompt = buildCoverRewritePrompt({
          originalPrompt: userPrompt,
          draft: finalCover,
          qualityReport,
          context: coverContext,
          localeProfile,
          targetWordRange,
        });
        content = await callProviderWithFallback({
          provider: providerConfig.provider,
          apiKey: providerConfig.apiKey,
          normalizedModel,
          defaultModel,
          systemPrompt,
          userPrompt: rewritePrompt,
          // Cover-only rewrite — slight headroom for tone variation
          // (resume bullets are not regenerated in this pass).
          temperature: 0.35,
        });

        const rewrittenRaw = parseTailorModelOutput(content);
        if (rewrittenRaw) {
          const rewrittenCover: ParsedModelPayload["cover"] = {
            candidateTitle: normalizeText(rewrittenRaw.cover.candidateTitle),
            subject: normalizeText(rewrittenRaw.cover.subject),
            date: normalizeText(rewrittenRaw.cover.date),
            salutation: normalizeText(rewrittenRaw.cover.salutation),
            paragraphOne: normalizeText(rewrittenRaw.cover.paragraphOne),
            paragraphTwo: normalizeText(rewrittenRaw.cover.paragraphTwo),
            paragraphThree: normalizeText(rewrittenRaw.cover.paragraphThree),
            closing: normalizeText(rewrittenRaw.cover.closing),
            signatureName: normalizeText(rewrittenRaw.cover.signatureName),
          };
          finalCover = normalizeCoverDraft(rewrittenCover, fallback.cover);
          qualityReport = evaluateCoverQuality({
            draft: finalCover,
            context: coverContext,
            company: input.company,
            targetWordRange,
          });
        }
      }

      if (!qualityReport.passed) {
        const failedFallback = buildFallback(input, "quality_gate_failed");
        return {
          cvSummary: parsed.cvSummary || fallback.cvSummary,
          cover: failedFallback.cover,
          source: {
            cv: parsed.cvSummary ? "ai" : "base",
            cover: "fallback",
          },
          reason: "quality_gate_failed",
          qualityReport,
        };
      }
    }

    return {
      cvSummary: parsed.cvSummary || fallback.cvSummary,
      cover: finalCover,
      source: {
        cv: parsed.cvSummary ? "ai" : "base",
        cover: finalCover.paragraphOne || finalCover.paragraphTwo || finalCover.paragraphThree ? "ai" : "fallback",
      },
      reason: "ai_ok",
      qualityReport,
    };
  } catch {
    return buildFallback(input, "provider_error");
  }
}
