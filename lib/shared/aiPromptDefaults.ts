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
      "Tailor the candidate's existing resume to the role by adapting cvSummary and proposing grounded additions only. Do not invent a new profile.",
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
      "Keep every proposed addition grounded in Master Resume Profile facts and technologies; do not fabricate scope, systems, ownership, or outcomes.",
  },
  {
    id: "cv.grounding.04",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Do not invent numeric metrics. Mine real numbers from candidate evidence first; otherwise use truthful qualitative outcomes such as scope, efficiency, reliability, quality, stakeholder, or business impact.",
  },
  {
    id: "cv.grounding.05",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "If evidence is insufficient for a JD point, do not add a speculative bullet for it.",
  },
  {
    id: "cv.grounding.06",
    category: "grounding",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "For newly added bullets, prefer complementary JD-required concepts that are supported by candidate evidence and not already emphasized in the latest experience.",
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
      "Preserve the base summary length within approximately 10% and keep its sentence count. If it is missing, generate a grounded 2-3 sentence summary of 150-250 characters.",
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
      "Return latestExperience.addedBullets as additions only. The Master Resume Profile owns every existing bullet, so never copy existing bullets into the output.",
  },
  {
    id: "cv.content.03",
    category: "content",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Each added bullet should follow Google XYZ style: Achieved X by doing Y, resulting in Z, or a grounded qualitative equivalent when metrics are unavailable.",
  },
  {
    id: "cv.content.04",
    category: "content",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Start each added bullet with a strong, specific action verb such as Led, Architected, Shipped, Designed, Migrated, Optimized, Automated, Implemented, Drove, or Delivered.",
  },
  {
    id: "cv.content.05",
    category: "content",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Each added bullet must introduce a meaningfully different JD-relevant concept. Keep only the strongest bullet when two additions cover the same theme.",
  },
  {
    id: "cv.content.06",
    category: "content",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Keep each added bullet similar in length and tone to the Master Resume Profile. Target under 200 characters and never exceed 250 characters.",
  },
  {
    id: "cv.coverage.01",
    category: "coverage",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "When top JD responsibilities are under-covered and grounded evidence exists, propose only the minimum useful additions, with an absolute maximum of three.",
  },
  {
    id: "cv.coverage.02",
    category: "coverage",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Prioritize uncovered top JD responsibilities first when choosing added bullets.",
  },
  {
    id: "cv.coverage.03",
    category: "coverage",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "If a top responsibility requires unsupported technology, skip it and use another responsibility or adjacent proven technology only when candidate evidence supports it.",
  },
  {
    id: "cv.style.02",
    category: "style",
    priority: "high",
    appliesTo: ["resume"],
    text:
      "Bold at least one JD-critical keyword in every added bullet using syntactically clean **keyword** markers.",
  },
  {
    id: "cv.structure.02",
    category: "structure",
    priority: "critical",
    appliesTo: ["resume"],
    text:
      "Resume output contains cvSummary and latestExperience.addedBullets only. Never return a cover payload or a skills payload.",
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
