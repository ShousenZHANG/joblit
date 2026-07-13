import type { PromptSkillRuleSet } from "./promptSkills";
import {
  buildApplicationSystemPrompt,
  buildApplicationUserPrompt,
} from "./applicationPromptBuilder";
import { truncate } from "@/lib/shared/utils/text";

type TailorPromptInput = {
  baseSummary: string;
  jobTitle: string;
  company: string;
  description: string;
  coverContext?: {
    topResponsibilities: string[];
    matchedEvidence: string[];
    resumeHighlights: string[];
  };
};

function formatList(title: string, items: string[]) {
  if (!items.length) return `${title}\n1. (none)`;
  return `${title}\n${items.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}`;
}

export function buildTailorPrompts(
  rules: PromptSkillRuleSet,
  input: TailorPromptInput,
) {
  const systemPrompt = [
    buildApplicationSystemPrompt(rules),
    "You are also a senior recruiter-level writing reviewer.",
  ].join("\n\n");

  const topResponsibilities = input.coverContext?.topResponsibilities ?? [];
  const matchedEvidence = input.coverContext?.matchedEvidence ?? [];
  const resumeHighlights = input.coverContext?.resumeHighlights ?? [];

  const resumeGuidancePrompt = buildApplicationUserPrompt({
    target: "resume",
    rules,
    job: {
      title: input.jobTitle,
      company: input.company,
      description: input.description,
    },
    resume: {
      baseLatestBullets: matchedEvidence,
      coverage: {
        topResponsibilities,
        missingFromBase: topResponsibilities,
        fallbackResponsibilities: resumeHighlights.length ? resumeHighlights : topResponsibilities,
        requiredNewBulletsMin: 2,
        requiredNewBulletsMax: 3,
      },
    },
  });

  const coverGuidancePrompt = buildApplicationUserPrompt({
    target: "cover",
    rules,
    job: {
      title: input.jobTitle,
      company: input.company,
      description: input.description,
    },
  });

  const coverEvidenceBlock = input.coverContext
    ? `
${formatList(
  "Top JD responsibilities (priority order):",
  input.coverContext.topResponsibilities,
)}

${formatList(
  "Matched resume evidence (highest relevance):",
  input.coverContext.matchedEvidence,
)}

${formatList(
  "Additional resume highlights:",
  input.coverContext.resumeHighlights,
)}
`
    : "";

  const userPrompt = [
    "Task:",
    "Generate role-tailored CV summary and Cover Letter content in one strict JSON payload.",
    "",
    "Required JSON shape:",
    "{",
    '  "cvSummary": "string",',
    '  "cover": {',
    '    "candidateTitle": "string (optional)",',
    '    "subject": "string (optional)",',
    '    "date": "string (optional)",',
    '    "salutation": "string (optional)",',
    '    "paragraphOne": "string",',
    '    "paragraphTwo": "string",',
    '    "paragraphThree": "string",',
    '    "closing": "string (optional)",',
    '    "signatureName": "string (optional)"',
    "  }",
    "}",
    "",
    "Use the following guidance blocks (same source as Joblit Generate Prompt).",
    "",
    "Resume guidance:",
    resumeGuidancePrompt,
    "",
    "Cover guidance:",
    coverGuidancePrompt,
    "",
    ...(coverEvidenceBlock ? [coverEvidenceBlock.trim(), ""] : []),
    "Input:",
    `- Base summary: ${truncate(input.baseSummary, 1200)}`,
    `- Job title: ${input.jobTitle}`,
    `- Company: ${input.company}`,
    `- Job description: ${truncate(input.description, 2400)}`,
  ].join("\n");

  return { systemPrompt, userPrompt };
}
