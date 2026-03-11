import type { PromptSkillRuleSet } from "@/lib/server/ai/promptSkills";
import { getExpectedJsonShapeForTarget, type PromptTarget } from "@/lib/server/ai/promptContract";

type JobInput = {
  title: string;
  company: string;
  description: string;
};

type ResponsibilityCoverageInput = {
  topResponsibilities: string[];
  missingFromBase: string[];
  fallbackResponsibilities: string[];
  requiredNewBulletsMin: number;
  requiredNewBulletsMax: number;
};

type ResumePromptInput = {
  baseLatestBullets: string[];
  coverage: ResponsibilityCoverageInput;
};

type BuildApplicationPromptInput = {
  target: PromptTarget;
  rules: PromptSkillRuleSet;
  job: JobInput;
  resume?: ResumePromptInput;
};

function formatRuleBlock(title: string, items: string[]) {
  return `${title}\n${items.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}

function buildResumeCoverageBlock(input: ResumePromptInput) {
  const { baseLatestBullets, coverage } = input;
  return [
    "Top-3 Responsibility Alignment (guidance):",
    "Extraction priority: action bullets under headings such as Responsibilities, What You'll Do, What You'll Be Doing, What You Could Work On, Key Responsibilities, Your Responsibilities, Required Skills, What You'll Bring, What You Offer, About You, and Your Profile.",
    "Only candidate-owned execution responsibilities are included below. Company intro, mission, funding, and office/location narrative are excluded.",
    ...(coverage.topResponsibilities.length
      ? coverage.topResponsibilities.map((item, index) => `${index + 1}. ${item}`)
      : ["1. (none parsed from JD)"]),
    "",
    "Base latest experience bullets (verbatim, reorder only):",
    ...(baseLatestBullets.length
      ? baseLatestBullets.map((item, index) => `${index + 1}. ${item}`)
      : ["1. (none found in base latest experience)"]),
    "",
    "Responsibilities missing from base latest bullets:",
    ...(coverage.missingFromBase.length
      ? coverage.missingFromBase.map((item, index) => `${index + 1}. ${item}`)
      : ["1. (none)"]),
    "",
    "Fallback responsibility pool (use when top-3 items require unsupported tech):",
    ...(coverage.fallbackResponsibilities.length
      ? coverage.fallbackResponsibilities.map((item, index) => `${index + 1}. ${item}`)
      : ["1. (none parsed or already covered)"]),
    "",
    coverage.missingFromBase.length
      ? `Suggested additions: target ${coverage.requiredNewBulletsMin}-${coverage.requiredNewBulletsMax} grounded new bullets for uncovered responsibilities when supported by base resume evidence.`
      : "Suggested additions: no additions required; reorder existing bullets only if helpful.",
    "",
    "Execution checklist:",
    "1) Preserve every base latest-experience bullet text verbatim (no paraphrase).",
    "2) Target additions count:",
    ...(coverage.missingFromBase.length
      ? [
          `2a) Add at least ${coverage.requiredNewBulletsMin} and at most ${coverage.requiredNewBulletsMax} new bullets when grounded evidence exists.`,
        ]
      : ["2a) No additions required when top-3 responsibilities are already covered."]),
    "2b) New bullets are allowed only when supported by explicit base resume evidence (latest experience / projects / skills).",
    "2c) First priority: align additions to uncovered top-3 responsibilities.",
    "2d) If top-3 needs tech you have not used, do not fabricate; use fallback responsibilities or adjacent proven technologies to complete the first 2 additions when possible.",
    "2e) Only when no grounded additions are possible at all, return reordered base bullets with zero additions.",
    "3) For every new bullet, bold 1-3 JD-critical keywords using **keyword**.",
    "3a) Keep markdown bold markers clean: **keyword** (no spaces inside markers).",
    "3b) In cvSummary, bold JD-critical keywords using clean markdown **keyword** markers.",
    "4) For added bullets, avoid repeating the same primary tech stack already present in base bullets; use complementary JD-required skills where possible.",
    "4a) Added bullets must introduce at least one meaningful new JD-relevant keyword; if not, do not add that bullet.",
    "5) If evidence is insufficient, keep bullets conservative and avoid fabrication.",
    "5a) Keep new bullets consistent with latest-experience timeframe and realistic scope.",
    "6) Resume target output must NOT include cover payload.",
  ].join("\n");
}

function buildResumeSkillsPolicyBlock() {
  return [
    "Skills output policy (must follow):",
    "1) Return skillsFinal as the complete final skills list (not delta).",
    "2) skillsFinal must contain max 5 major categories, each as { label, items }.",
    "3) Prioritize JD must-have skills first for ATS matching while staying grounded in base resume context.",
    "4) Prefer existing categories from resume snapshot and merge related items into the closest category.",
    "5) If a JD must-have has no grounded evidence in base context, use the closest truthful transferable skill; do not fabricate direct ownership.",
    "6) Order skillsFinal by JD relevance priority (most important first).",
    "7) Keep markdown bold markers clean: **keyword** (no inner spaces).",
    "8) Do NOT return skillsAdditions. Return skillsFinal only.",
    "9) Resume target JSON keys allowed: cvSummary, latestExperience, skillsFinal.",
  ].join("\n");
}

function buildCoverStructureBlock() {
  return [
    "Cover output structure (must follow):",
    "1) cover.subject: concise role-specific subject line (prefer 'Application for <Role>' only; do NOT append candidate name).",
    "2) cover.candidateTitle (optional): set to role-aligned candidate title for the letter header.",
    "3) cover.date: current or provided date string.",
    "4) cover.salutation: addressee only (e.g. 'Hiring Team at <Company>'); no leading 'Dear', no trailing comma.",
    "5) cover.paragraphOne: application intent + role-fit in one to two sentences, anchored in real experience. No generic openers ('I am writing to apply...'); lead with what the candidate brings.",
    "6) cover.paragraphTwo: map experience to JD responsibilities in priority order with concrete evidence and outcomes. Top-3 JD responsibilities first; lead with what they did and the result. Scannable and evidence-first.",
    "6a) If direct evidence is missing, do not claim it; use only adjacent proven evidence that is factually supportable.",
    "7) cover.paragraphThree: why this role/company — one or two specific points. Natural first-person; understated Australian tone (e.g. 'The focus on X aligns with where I want to grow'). No generic enthusiasm or 'I would be a great fit'.",
    "8) Bold all JD-critical keywords in the cover using **keyword** (clean markers only). Keep bolding readable.",
    "9) cover.closing + cover.signatureName: include when possible.",
    "10) Australian workplace + big tech standard: direct, concise, understated confidence; collaborative tone; no hype or filler. Sound human and specific. Target 280–360 words across three paragraphs.",
    "11) Cover target JSON keys allowed: cover only (no cvSummary/latestExperience/skillsFinal).",
  ].join("\n");
}

export function buildApplicationSystemPrompt(rules: PromptSkillRuleSet) {
  return [
    `You are Jobflow's external AI tailoring assistant (${rules.locale}).`,
    "Your job: (1) Resume target — tailor the candidate's existing resume to the role (adapt cvSummary, reorder/add bullets, adapt skills); (2) Cover target — generate a role-specific cover letter using the candidate's resume as the only evidence. In both cases, the candidate's resume context is the single source of truth; do not invent facts.",
    "Use the imported skill package for rules and output format. Read base resume context from jobflow-tailoring/context/resume-snapshot.json (summary, experiences, skills).",
    "Output strict JSON only (no code fences, no markdown prose outside JSON).",
    "Markdown bold markers inside JSON string values are allowed when explicitly requested.",
    "Ensure valid JSON strings: use \\n for line breaks and escape quotes.",
    "Do not output file/path diagnostics or process notes.",
    formatRuleBlock("Hard Constraints:", rules.hardConstraints),
  ].join("\n\n");
}

export function buildApplicationUserPrompt(input: BuildApplicationPromptInput) {
  const isResumeTarget = input.target === "resume";
  const requiredJsonShape = JSON.stringify(getExpectedJsonShapeForTarget(input.target), null, 2).split("\n");
  const targetTaskLine = isResumeTarget
    ? "Tailor the candidate's resume for this role: produce cvSummary, latestExperience.bullets, and skillsFinal from their resume context; preserve existing bullets verbatim, reorder and add only grounded new bullets per rules."
    : "Generate a cover letter for this role using the candidate's resume as evidence; follow the pack's cover structure and rules.";
  const strictResumeBulletLine = isResumeTarget
    ? "Strict resume bullet rule: preserve every existing latest-experience bullet text verbatim; only reorder existing bullets and add new bullets per rules."
    : "";
  const targetRulesBlock = isResumeTarget
    ? formatRuleBlock("CV Skills Rules:", input.rules.cvRules)
    : formatRuleBlock("Cover Letter Skills Rules:", input.rules.coverRules);
  const resumeCoverageBlock = isResumeTarget && input.resume ? buildResumeCoverageBlock(input.resume) : "";
  const resumeSkillsPolicyBlock = isResumeTarget ? buildResumeSkillsPolicyBlock() : "";
  const coverStructureBlock = isResumeTarget ? "" : buildCoverStructureBlock();

  return [
    "Task:",
    targetTaskLine,
    ...(strictResumeBulletLine ? ["", strictResumeBulletLine] : []),
    "",
    "Required JSON shape:",
    ...requiredJsonShape,
    "",
    "JSON-only requirement applies to outer output structure; markdown bold markers are allowed inside JSON string values when requested.",
    "",
    ...(resumeCoverageBlock ? [resumeCoverageBlock, ""] : []),
    ...(resumeSkillsPolicyBlock ? [resumeSkillsPolicyBlock, ""] : []),
    ...(coverStructureBlock ? [coverStructureBlock, ""] : []),
    targetRulesBlock,
    "",
    "Job Input:",
    `- Job title: ${input.job.title}`,
    `- Company: ${input.job.company || "the company"}`,
    `- Job description: ${input.job.description || ""}`,
  ].join("\n");
}

/** Short user prompt for when the model already has the jobflow-tailoring pack loaded. Only job-specific inputs + one-line instruction. */
export function buildApplicationShortUserPrompt(input: {
  target: PromptTarget;
  job: JobInput;
  resume?: ResumePromptInput;
}): string {
  const lines = [
    `Target: ${input.target}`,
    "",
    "Job Input:",
    `- Job title: ${input.job.title}`,
    `- Company: ${input.job.company || "the company"}`,
    `- Job description: ${input.job.description || ""}`,
  ];
  if (input.target === "resume" && input.resume) {
    lines.push("", buildResumeCoverageBlock(input.resume));
  }
  return lines.join("\n");
}

export function getTemplateResumePromptInput(baseLatestBullets: string[]): ResumePromptInput {
  return {
    baseLatestBullets: baseLatestBullets.length
      ? baseLatestBullets
      : ["{{BASE_LATEST_BULLET_1}}", "{{BASE_LATEST_BULLET_2}}"],
    coverage: {
      topResponsibilities: [
        "{{TOP_RESPONSIBILITY_1}}",
        "{{TOP_RESPONSIBILITY_2}}",
        "{{TOP_RESPONSIBILITY_3}}",
      ],
      missingFromBase: ["{{MISSING_RESPONSIBILITY_1}}", "{{MISSING_RESPONSIBILITY_2}}"],
      fallbackResponsibilities: ["{{FALLBACK_RESPONSIBILITY_1}}", "{{FALLBACK_RESPONSIBILITY_2}}"],
      requiredNewBulletsMin: 2,
      requiredNewBulletsMax: 3,
    },
  };
}
