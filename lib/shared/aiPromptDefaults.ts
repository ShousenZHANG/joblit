import { CV_SUMMARY_LENGTH } from "@/lib/shared/schemas/applicationGenerationOutput";

export type SkillRuleDef = {
  id: string;
  category:
    | "grounding"
    | "structure"
    | "content"
    | "style"
    | "ats"
    | "coverage"
    | "locale";
  priority: "critical" | "high" | "normal";
  text: string;
  appliesTo: ("resume" | "cover")[];
  locale?: "en-AU" | "zh-CN" | "all";
};

/**
 * Structured definitions are the source of truth. Flat rule arrays exist only
 * for the legacy PromptRuleTemplate storage shape and are derived below.
 * Output keys and cardinality remain contract-owned in promptContract.ts.
 */
export const STRUCTURED_CV_RULES: SkillRuleDef[] = [
  {
    id: "cv.grounding.01",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Tailor the candidate's existing resume to the role by rewriting cvSummary and choosing which of their own skills the resume shows. Do not invent a new profile.",
  },
  {
    id: "cv.ats.01",
    category: "ats",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Act as a FAANG Senior Technical Recruiter who reviews 200+ resumes daily. Prioritize role-fit evidence, impact clarity, and ATS keyword alignment. Reject anything that would not survive a 6-second recruiter scan.",
  },
  {
    id: "cv.grounding.02",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Do not add claims beyond the Master Resume Profile. Keep every statement grounded in the provided candidate evidence.",
  },
  {
    id: "cv.grounding.03",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Keep cvSummary grounded in Master Resume Profile facts and technologies; do not fabricate scope, systems, ownership, or outcomes.",
  },
  {
    id: "cv.grounding.04",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Do not invent numeric metrics. Every number in cvSummary must already appear in the candidate evidence; otherwise use truthful qualitative outcomes such as scope, efficiency, reliability, quality, stakeholder, or business impact.",
  },
  {
    id: "cv.grounding.05",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "If evidence is insufficient for a JD point, leave it out of the summary rather than asserting it.",
  },
  {
    id: "cv.grounding.07",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "If a JD must-have has no direct evidence, use only a truthful adjacent or transferable capability; never imply direct ownership.",
  },
  {
    id: "cv.content.01",
    category: "content",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Rewrite cvSummary using this formula: {role-aligned identity} + {years or scope} + {2-3 strengths mapped to top JD requirements} + {signature grounded achievement}.",
  },
  {
    id: "cv.content.02",
    category: "content",
    priority: "high",
    appliesTo: ["resume"],
    text:
      `Write cvSummary as 2-3 sentences of ${CV_SUMMARY_LENGTH.min}-${CV_SUMMARY_LENGTH.max} characters. It must contain the posting's role title, with seniority words and trailing qualifiers dropped.`,
  },
  {
    id: "cv.content.07",
    category: "content",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Claim no title, level, or years of experience the candidate's own dates and job titles cannot support. Mirror the role, never the rank.",
  },
  {
    id: "cv.style.01",
    category: "style",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Bold 3-5 JD-aligned technical keywords in cvSummary using clean markdown **keyword** markers. Avoid over-bolding.",
  },
  {
    id: "cv.structure.01",
    category: "structure",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Return skillsSelection as index references into the Master Resume Profile's own skills. Never write a skill name, and never reference an index the profile does not have.",
  },
  {
    id: "cv.structure.03",
    category: "structure",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Each skill group may be selected at most once, and each index at most once within its group.",
  },
  {
    id: "cv.coverage.01",
    category: "coverage",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Lead cvSummary with the top JD responsibilities the candidate can actually evidence, and ignore the ones the profile cannot support.",
  },
  {
    id: "cv.coverage.02",
    category: "coverage",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Sequence skillsSelection so the groups and skills this posting rewards come first. Array order is render order on the PDF.",
  },
  {
    id: "cv.coverage.03",
    category: "coverage",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "If a top responsibility requires unsupported technology, skip it and lean on another responsibility or an adjacent proven technology only when candidate evidence supports it.",
  },
  {
    id: "cv.style.02",
    category: "style",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Keep the selection tight: drop the groups and items this posting does not care about instead of shipping the whole master list.",
  },
  {
    id: "cv.structure.02",
    category: "structure",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Resume output contains cvSummary and skillsSelection only. Never return a cover payload, experience text, or skill strings.",
  },
  {
    id: "cv.style.03",
    category: "style",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Prefer concrete, ATS-safe phrasing. Avoid hype, fluff, repeated adjectives, and claims the candidate could not defend in an interview.",
  },
];

export const STRUCTURED_COVER_RULES: SkillRuleDef[] = [
  {
    id: "cover.grounding.01",
    category: "grounding",
    priority: "critical",
    appliesTo: ["cover"],
    text:
      "Generate the cover letter from the Master Resume Profile only; every claim must be grounded in candidate evidence.",
  },
  {
    id: "cover.grounding.02",
    category: "grounding",
    priority: "critical",
    appliesTo: ["cover"],
    text:
      "Do not fabricate employers, tools, projects, metrics, domain exposure, seniority, or outcomes.",
  },
  {
    id: "cover.grounding.03",
    category: "grounding",
    priority: "critical",
    appliesTo: ["cover"],
    text:
      "If direct evidence is missing for a JD point, omit the claim or use only an explicitly supported adjacent capability.",
  },
  {
    id: "cover.style.01",
    category: "style",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Write in a natural first-person candidate voice. Sound like a real person, not a recruiter or template engine.",
  },
  {
    id: "cover.structure.01",
    category: "structure",
    priority: "critical",
    appliesTo: ["cover"],
    text:
      "Return one cover object containing exactly paragraphOne, paragraphTwo, and paragraphThree.",
  },
  {
    id: "cover.structure.02",
    category: "structure",
    priority: "critical",
    appliesTo: ["cover"],
    text:
      "Use three substantial semantic sections: application intent and role fit, evidence mapping, then motivation and forward contribution.",
  },
  {
    id: "cover.content.01",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Paragraph one states the target role and role fit in one or two sentences anchored in real experience. Lead with what the candidate brings and avoid generic application openers.",
  },
  {
    id: "cover.content.02",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Paragraph one must pass the so-what test: a recruiter should immediately understand why the candidate is worth reading further.",
  },
  {
    id: "cover.content.03",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Paragraph two maps candidate evidence to JD responsibilities in priority order. Lead with what the candidate did and its grounded outcome.",
  },
  {
    id: "cover.coverage.01",
    category: "coverage",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Address the top-3 JD responsibilities first using only evidence from the Master Resume Profile.",
  },
  {
    id: "cover.content.04",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Quantify paragraph-two outcomes only when candidate evidence provides real numbers; otherwise use specific qualitative outcomes.",
  },
  {
    id: "cover.content.05",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Paragraph three explains why this role or company using one or two specific JD-supported points, then states what the candidate would contribute.",
  },
  {
    id: "cover.content.06",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "The final sentence includes a clear professional call to action rather than a passive or generic ending.",
  },
  {
    id: "cover.locale.01",
    category: "locale",
    priority: "normal",
    appliesTo: ["cover"],
    locale: "en-AU",
    text:
      "Use natural Australian English: direct, concise, collaborative, and confidently understated. Avoid American corporate buzzwords and excessive self-promotion.",
  },
  {
    id: "cover.locale.02",
    category: "locale",
    priority: "normal",
    appliesTo: ["cover"],
    locale: "zh-CN",
    text:
      "使用专业、简洁的简体中文求职信语气，以证据和岗位匹配为导向，避免空泛客套和过度自我宣传。",
  },
  {
    id: "cover.style.02",
    category: "style",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Bold 4-6 JD-critical keywords across the three paragraphs with clean markdown **keyword** markers, spread evenly for readability.",
  },
  {
    id: "cover.style.03",
    category: "style",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Use an evidence-first, scannable, natural professional tone. Avoid superlatives, hype, filler, and recruiter boilerplate.",
  },
  {
    id: "cover.content.07",
    category: "content",
    priority: "high",
    appliesTo: ["cover"],
    text:
      "Target the locale-specific word range across all three paragraphs. Every sentence must add concrete understanding of role fit.",
  },
];

export const STRUCTURED_HARD_CONSTRAINTS: SkillRuleDef[] = [
  {
    id: "hard.json",
    category: "structure",
    priority: "critical",
    appliesTo: ["resume", "cover"],
    text:
      "Return JSON only (no code fences or prose outside JSON). Markdown bold markers inside JSON string values are allowed when requested.",
  },
  {
    id: "hard.no-latex",
    category: "structure",
    priority: "critical",
    appliesTo: ["resume", "cover"],
    text: "Do not output LaTeX in the model response.",
  },
  {
    id: "hard.no-fabrication",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume", "cover"],
    text:
      "Never invent skills, tools, metrics, employers, responsibilities, dates, scope, or outcomes not present in candidate evidence.",
  },
  {
    id: "hard.conservative",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume", "cover"],
    text:
      "When JD requirements or candidate evidence are unclear, keep the output conservative and omit unsupported claims.",
  },
];

function flatRulesForLocale(
  rules: SkillRuleDef[],
  locale: "en-AU" | "zh-CN",
): string[] {
  return rules
    .filter(
      (rule) =>
        !rule.locale || rule.locale === "all" || rule.locale === locale,
    )
    .map((rule) => rule.text);
}

export const DEFAULT_CV_RULES = flatRulesForLocale(
  STRUCTURED_CV_RULES,
  "en-AU",
);
export const DEFAULT_COVER_RULES = flatRulesForLocale(
  STRUCTURED_COVER_RULES,
  "en-AU",
);
