import type { PromptSkillRuleSet } from "@/lib/server/ai/promptSkills";
import type { StructuredRuleSet, SkillRule } from "@/lib/server/ai/promptSkills";
import {
  buildSkillPackVersion,
  PROMPT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
  getExpectedJsonSchemaForTarget,
} from "@/lib/server/ai/promptContract";
import {
  buildApplicationSystemPrompt,
  buildApplicationUserPrompt,
  getTemplateResumePromptInput,
} from "@/lib/server/ai/applicationPromptBuilder";
import { getLocaleProfile } from "@/lib/shared/locales";
import {
  buildRealisticResumeExample,
  buildAnnotatedResumeWalkthrough,
  buildRealisticCoverExample,
  buildAnnotatedCoverWalkthrough,
} from "@/lib/server/ai/skillPackExamples";

type SkillPackContext = {
  resumeSnapshot: unknown;
  resumeSnapshotUpdatedAt: string;
};

type SkillPackOptions = {
  redactContext?: boolean;
};

function list(items: string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function redactResumeSnapshot(snapshot: unknown) {
  const record =
    snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : {};
  return {
    summary: "[REDACTED]",
    basics: null,
    links: [],
    skills: [],
    experiences: [],
    projects: [],
    education: [],
    hasSourceData: Object.keys(record).length > 0,
  };
}

function extractLatestExperienceBullets(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return [] as string[];
  const record = snapshot as Record<string, unknown>;
  const experiences = Array.isArray(record.experiences) ? record.experiences : [];
  const latest = experiences[0];
  if (!latest || typeof latest !== "object") return [] as string[];
  const latestRecord = latest as Record<string, unknown>;
  const bullets = Array.isArray(latestRecord.bullets) ? latestRecord.bullets : [];
  return bullets.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function buildPromptFiles(
  rules: PromptSkillRuleSet,
  context?: SkillPackContext,
  options?: SkillPackOptions,
) {
  const systemPromptTemplate = buildApplicationSystemPrompt(rules);
  const jobTemplateInput = {
    title: "{{JOB_TITLE}}",
    company: "{{COMPANY}}",
    description: "{{JOB_DESCRIPTION}}",
  };
  const resumeTemplateInput = getTemplateResumePromptInput(
    extractLatestExperienceBullets(context?.resumeSnapshot),
  );
  const resumePromptTemplate = buildApplicationUserPrompt({
    target: "resume",
    rules,
    job: jobTemplateInput,
    resume: resumeTemplateInput,
  });
  const coverPromptTemplate = buildApplicationUserPrompt({
    target: "cover",
    rules,
    job: jobTemplateInput,
  });

  const files = [
    { name: "jobflow-tailoring/prompts/system.txt", content: systemPromptTemplate },
    { name: "jobflow-tailoring/prompts/resume-user.txt", content: resumePromptTemplate },
    { name: "jobflow-tailoring/prompts/cover-user.txt", content: coverPromptTemplate },
  ];

  if (!context) return files;

  const snapshot = options?.redactContext
    ? redactResumeSnapshot(context.resumeSnapshot)
    : context.resumeSnapshot ?? {};

  files.push({
    name: "jobflow-tailoring/context/resume-snapshot.json",
    content: JSON.stringify(snapshot, null, 2),
  });
  files.push({
    name: "jobflow-tailoring/context/resume-snapshot-updated-at.txt",
    content: context.resumeSnapshotUpdatedAt,
  });

  return files;
}

export function buildGlobalSkillPackFiles(
  rules: PromptSkillRuleSet,
  context?: SkillPackContext,
  options?: SkillPackOptions,
) {
  const readme = `# Jobflow Global Skill Pack

This pack defines reusable rules and prompt templates for CV/Cover generation.
The default rule profile is recruiter-grade and enforces Google XYZ-style bullets for new experience points.

## How to use
1. Open your external AI chat tool.
2. Upload or paste files from this pack.
3. Replace placeholders in prompts with your current job data:
   - {{JOB_TITLE}}
   - {{COMPANY}}
   - {{JOB_DESCRIPTION}}
4. Use \`prompts/system.txt\` as system prompt and the target user prompt (\`prompts/resume-user.txt\` or \`prompts/cover-user.txt\`).
5. Use \`schema/output.resume.schema.json\` for CV or \`schema/output.cover.schema.json\` for cover.
6. Paste target JSON back into Jobflow via Generate CV / Generate Cover Letter.

## Notes
- This is a global template pack, not bound to one specific job.
- This pack may include your latest resume snapshot and snapshot timestamp file.
- Prompt template version: ${PROMPT_TEMPLATE_VERSION}
- Output schema version: ${PROMPT_SCHEMA_VERSION}
- Prompt generation for each job is done separately in Jobflow UI.
- Prompt templates in this pack are generated from the same builder used by \`/api/applications/prompt\`.
- Rules version id: ${rules.id}
- Locale: ${rules.locale}
`;

  const skillMd = `---
name: jobflow-tailoring
description: Use when a job description is provided and tailored CV or Cover Letter JSON is needed for Jobflow import.
version: ${rules.id}
locale: ${rules.locale}
---

# Jobflow Tailoring Skill

## Trigger Conditions
Use this skill when:
- A job description is provided and you need to **tailor the candidate's resume** for the role or **generate a cover letter** from their resume.
- Output will be pasted back into Jobflow to render PDF.
- The candidate's resume (context) is the only source of truth; do not invent skills, employers, or experience.
- Accuracy, ATS safety, and deterministic JSON format are required.

## Required Inputs
- Job title
- Company
- Job description
- Resume snapshot context from \`context/resume-snapshot.json\`
- Target: \`resume\` or \`cover\`

## Hard Constraints
${list(rules.hardConstraints)}

## CV Rules
${list(rules.cvRules)}

## Cover Rules
${list(rules.coverRules)}

## Execution Procedure
1. Determine target: \`resume\` = tailor the candidate's existing resume to the role; \`cover\` = generate a cover letter from their resume.
2. Read JD responsibilities and required skills in order of importance. Use the candidate's resume context for all factual content.
3. For \`resume\` target:
   - Produce \`cvSummary\`.
   - Produce complete \`latestExperience.bullets\` list (ordered final list).
   - Produce \`skillsFinal\` as complete final skills list (not delta).
   - Keep \`skillsFinal\` within 5 major categories and prioritize existing categories.
   - If top-3 responsibility gaps are found and grounded evidence exists, add 2-3 grounded bullets and put them first.
   - Prioritize uncovered top-3 responsibilities first for those additions.
   - If top-3 needs unsupported tech, do not claim it; use fallback JD responsibilities or adjacent proven technologies to complete the first 2 additions when possible.
   - If direct evidence is missing for a JD point, do not claim it; use only factually supportable adjacent evidence.
   - If evidence is insufficient for any grounded addition, keep reordered base bullets only.
   - For added bullets, avoid duplicating the same primary tech stack already used by base latest-experience bullets; prioritize complementary JD-required technologies.
   - Preserve every base latest-experience bullet verbatim (order change is allowed, text rewrite is not).
   - In \`cvSummary\`, bold JD-critical keywords with clean markdown markers: **keyword**.
   - For each newly added bullet, bold at least one JD-critical keyword with clean markdown markers: **keyword**.
4. For \`cover\` target:
   - Produce \`cover.paragraphOne/paragraphTwo/paragraphThree\` as three semantic sections (substantial, not forced short).
   - **Australian workplace (en-AU):** Direct, concise, understated confidence; collaborative tone; natural Australian English. Avoid American buzzwords and over-the-top enthusiasm; sound like a capable colleague.
   - **Big tech / enterprise standard:** Lead with evidence and fit; no generic openers. Evidence-first, scannable paragraphs; concrete outcomes over superlatives; human and specific, not templated.
   - Paragraph 1: application intent + role-fit anchored in real experience (no 'I am writing to apply').
   - Paragraph 2: map to JD responsibilities in priority order with concrete evidence; Top-3 first; what they did and the result.
   - Paragraph 3: why this role/company — one or two specific points; understated interest (e.g. 'The focus on X aligns with where I want to grow').
   - Include \`candidateTitle/subject/date/salutation/closing/signatureName\` when possible. Subject role-focused only; salutation without "Dear" or trailing comma.
   - Bold JD-critical keywords with **keyword**; keep voice professional but natural. Target 280–360 words total.
5. Validate JSON shape against schema before final output.
6. Output only the target contract: resume target cannot include cover keys; cover target cannot include resume keys.

## Output Contracts
- Resume output must match: \`schema/output.resume.schema.json\`
- Cover output must match: \`schema/output.cover.schema.json\`
- Contract metadata: \`meta/prompt-contract.json\`

## Verification Checklist
- Output is strict JSON only (no code fence and no markdown prose outside JSON).
- No fabricated facts, skills, employers, or metrics.
- Markdown bold markers are clean: **keyword** (no inner leading/trailing spaces).
- JSON-only requirement applies to outer structure; markdown bold markers are allowed inside JSON string values when requested.
- Resume output keeps every existing latest-experience bullet verbatim (reorder allowed).
- Resume \`cvSummary\` bolds JD-critical keywords with clean markdown while preserving readability.
- When top-3 is under-covered and grounded evidence exists, resume output targets 2-3 new bullets (never more than 3).
- Add grounded bullets only when evidence exists in base resume context; avoid fabrication.
- If top-3 needs unsupported tech, use fallback responsibilities or adjacent proven technologies before giving up additions.
- Added bullets should emphasize complementary JD-required tech rather than repeating already-covered primary stack.
- Each newly added bullet includes at least one clean markdown bold keyword (**keyword**).
- Skills output is \`skillsFinal\` (complete final list), JD-priority, and mapped to existing categories whenever possible.
- Never output \`skillsAdditions\`.
- Cover output includes three semantic sections mapped to \`paragraphOne/paragraphTwo/paragraphThree\`.
- Cover output maps Top-3 JD responsibilities first before secondary points.
- Cover output bolds all JD-critical keywords in output with clean markdown while keeping text readable.
- Cover text is candidate voice (not recruiter voice), factual, and role-specific.
- Cover reads as natural Australian workplace English: direct, concise, understated confidence; no generic openers or hype; evidence-first and scannable (big tech / enterprise standard).
- JSON parses without repair.

## Failure and Recovery
- If JD/resume context is insufficient, keep summary conservative and avoid new claims.
- If schema cannot be satisfied, return minimal valid JSON with conservative content.
- Never switch target contract (resume must not include cover payload, cover must not include resume payload).
`;

  const exampleJson = JSON.stringify(
    {
      cvSummary:
        "Focused software engineer with product delivery ownership across end-to-end features and cross-functional collaboration.",
      latestExperience: {
        bullets: ["...", "..."],
      },
      skillsFinal: [{ label: "Cloud", items: ["GCP"] }],
    },
    null,
    2,
  );

  const coverExampleJson = JSON.stringify(
    {
      cover: {
        candidateTitle: "{{ROLE_ALIGNED_TITLE}}",
        subject: "Application for {{JOB_TITLE}}",
        date: "5 February 2026",
        salutation: "Hiring Team at {{COMPANY}}",
        paragraphOne:
          "My recent work in **product delivery** and **cross-functional** teams has given me direct experience with the kind of outcomes you're looking for in the {{JOB_TITLE}} role.",
        paragraphTwo:
          "In my current role I led **end-to-end** feature delivery and **stakeholder** alignment—directly in line with your top responsibilities. I've also driven **technical** decisions and **roadmap** trade-offs with evidence from production. I can point to similar outcomes in [specific area from JD] and would bring that focus to {{COMPANY}}.",
        paragraphThree:
          "The focus on [specific product/team from JD] aligns with where I want to grow, and I'd like to contribute to that. I'm happy to discuss how my experience maps to your priorities.",
        closing: "Yours sincerely,",
        signatureName: "{{CANDIDATE_NAME}}",
      },
    },
    null,
    2,
  );

  const files: { name: string; content: string }[] = [
    { name: "jobflow-tailoring/README.md", content: readme },
    { name: "jobflow-tailoring/SKILL.md", content: skillMd },
    { name: "jobflow-tailoring/rules/cv-rules.md", content: list(rules.cvRules) },
    { name: "jobflow-tailoring/rules/cover-rules.md", content: list(rules.coverRules) },
    { name: "jobflow-tailoring/rules/hard-constraints.md", content: list(rules.hardConstraints) },
    ...buildPromptFiles(rules, context, options),
    {
      name: "jobflow-tailoring/schema/output.resume.schema.json",
      content: JSON.stringify(getExpectedJsonSchemaForTarget("resume"), null, 2),
    },
    {
      name: "jobflow-tailoring/schema/output.cover.schema.json",
      content: JSON.stringify(getExpectedJsonSchemaForTarget("cover"), null, 2),
    },
    {
      name: "jobflow-tailoring/meta/prompt-contract.json",
      content: JSON.stringify(
        {
          promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
          schemaVersion: PROMPT_SCHEMA_VERSION,
          rulesVersion: rules.id,
          locale: rules.locale,
          redactedContext: !!options?.redactContext,
        },
        null,
        2,
      ),
    },
    { name: "jobflow-tailoring/examples/output.resume.minimal.json", content: exampleJson },
    { name: "jobflow-tailoring/examples/output.cover.minimal.json", content: coverExampleJson },
  ];

  const resumeSnapshotUpdatedAt = context?.resumeSnapshotUpdatedAt ?? "missing-profile";
  const skillPackVersion = buildSkillPackVersion({
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt,
  });
  const fileList = files.map((f) => f.name).concat("jobflow-tailoring/meta/manifest.json");
  const manifest = {
    packName: "jobflow-tailoring",
    packVersion: rules.id,
    generatedAt: new Date().toISOString(),
    redacted: !!options?.redactContext,
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    schemaVersion: PROMPT_SCHEMA_VERSION,
    skillPackVersion,
    files: fileList,
  };
  files.push({
    name: "jobflow-tailoring/meta/manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });

  return files;
}

/* ── V2 Skill Pack Builder ── */

type SkillPackV2Options = {
  locale?: "en-AU" | "zh-CN";
  redactContext?: boolean;
};

function filterRulesByTarget(rules: SkillRule[], target: "resume" | "cover"): SkillRule[] {
  return rules.filter((r) => r.appliesTo.includes(target));
}

function filterRulesByPriority(
  rules: SkillRule[],
  priority: "critical" | "high" | "normal",
): SkillRule[] {
  return rules.filter((r) => r.priority === priority);
}

function formatRulesXml(rules: SkillRule[]): string {
  return rules.map((r) => `- [${r.id}] ${r.text}`).join("\n");
}

function buildRulesJson(
  target: "resume" | "cover",
  rules: SkillRule[],
): string {
  const filtered = filterRulesByTarget(rules, target);
  return JSON.stringify(
    {
      version: "2.0.0",
      rules: filtered.map((r) => ({
        id: r.id,
        category: r.category,
        priority: r.priority,
        text: r.text,
      })),
    },
    null,
    2,
  );
}

function buildHardConstraintsJson(constraints: SkillRule[]): string {
  return JSON.stringify(
    {
      version: "2.0.0",
      rules: constraints.map((r) => ({
        id: r.id,
        category: r.category,
        priority: r.priority,
        text: r.text,
      })),
    },
    null,
    2,
  );
}

function buildLocaleJson(locale: "en-AU" | "zh-CN"): string {
  const profile = getLocaleProfile(locale);
  return JSON.stringify(
    {
      locale: profile.locale,
      coverWordRange: profile.coverWordRange,
      dateFormat: profile.dateFormat,
      dateExample: profile.dateExample,
      salutationStyle: profile.salutationStyle,
      toneRules: profile.toneRules,
    },
    null,
    2,
  );
}

function buildV2SystemMd(locale: "en-AU" | "zh-CN"): string {
  return `<role>You are Jobflow's AI tailoring assistant (${locale}).</role>

<source-of-truth>The candidate's resume snapshot is the ONLY source of truth for all factual claims. Never invent skills, employers, projects, metrics, or responsibilities not present in the snapshot.</source-of-truth>

<hard-constraints>
1. Return JSON only (no code fences, no markdown prose outside JSON). Markdown **bold** markers inside JSON string values are allowed.
2. Do not output LaTeX in model response.
3. Never invent skills, tools, metrics, employers, or responsibilities not in provided context.
4. Keep edits conservative when JD responsibilities or required skills are unclear.
</hard-constraints>

<output-format>Strict JSON matching the target schema. Markdown **bold** markers inside JSON string values are allowed.</output-format>`;
}

function buildV2ResumeSkillMd(rules: SkillRule[]): string {
  const resumeRules = filterRulesByTarget(rules, "resume");
  const critical = filterRulesByPriority(resumeRules, "critical");
  const high = filterRulesByPriority(resumeRules, "high");

  return `---
name: jobflow-resume-tailoring
trigger: When a job description is provided and tailored CV JSON is needed
---

<execution-flow>
1. Read JD responsibilities and required skills
2. Tailor cvSummary with JD-aligned keywords (bold with **keyword**)
3. Reorder latestExperience.bullets to mirror JD priority
4. Add 2-3 grounded new bullets for coverage gaps
5. Build skillsFinal (max 5 categories, JD-priority order)
6. Run self-check from quality-gates.md
7. Output strict JSON
</execution-flow>

<rules priority="critical">
${formatRulesXml(critical)}
</rules>

<rules priority="high">
${formatRulesXml(high)}
</rules>`;
}

function buildV2CoverSkillMd(rules: SkillRule[]): string {
  const coverRules = filterRulesByTarget(rules, "cover");
  const critical = filterRulesByPriority(coverRules, "critical");
  const high = filterRulesByPriority(coverRules, "high");

  return `---
name: jobflow-cover-tailoring
trigger: When a job description is provided and a tailored cover letter JSON is needed
---

<execution-flow>
1. Read JD responsibilities and required skills
2. Draft paragraphOne: application intent + role-fit anchored in real experience
3. Draft paragraphTwo: map top-3 JD responsibilities with concrete evidence
4. Draft paragraphThree: why this role/company with specific points
5. Bold JD-critical keywords with **keyword** across all paragraphs
6. Populate metadata fields (candidateTitle, subject, date, salutation, closing, signatureName)
7. Run self-check from quality-gates.md
8. Output strict JSON
</execution-flow>

<rules priority="critical">
${formatRulesXml(critical)}
</rules>

<rules priority="high">
${formatRulesXml(high)}
</rules>`;
}

function buildV2QualityGatesMd(locale: "en-AU" | "zh-CN"): string {
  const profile = getLocaleProfile(locale);
  const wordRange = `${profile.coverWordRange.min}-${profile.coverWordRange.max}`;

  return `# Quality Gates -- Self-Check Protocol

## Resume Target Checks
- [ ] BULLET_PRESERVATION: Every base bullet appears verbatim
- [ ] GROUNDING: No new bullet references skills not in snapshot
- [ ] ADDITION_COUNT: 2-3 new bullets when gaps exist, 0 when covered
- [ ] BOLD_MARKERS: Clean **keyword** in new bullets and cvSummary
- [ ] SKILLS_COMPLETE: skillsFinal is complete final list, max 5 categories
- [ ] JSON_VALID: Strict JSON, no code fences, no markdown outside JSON

## Cover Target Checks
- [ ] STRUCTURE: Three paragraphs, p1>=60 chars, p2>=90 chars, p3>=60 chars
- [ ] WORD_COUNT: ${wordRange} words across three paragraphs
- [ ] RESPONSIBILITY_COVERAGE: Paragraph 2 covers >=2 of top-3 JD responsibilities
- [ ] EVIDENCE_GROUNDING: Claims overlap with >=3 resume evidence keywords
- [ ] KEYWORD_BOLDING: >=3 JD-critical keywords bolded with **keyword**
- [ ] MOTIVATION_SPECIFIC: Paragraph 3 mentions company or specific JD topic`;
}

function buildV2ResumePromptTemplateMd(): string {
  return `<task>Tailor the candidate's resume for this role.</task>

<job>
- Title: {{JOB_TITLE}}
- Company: {{COMPANY}}
- Description:
{{JOB_DESCRIPTION}}
</job>

<instructions>
Follow the resume-skill.md rules. Run quality-gates.md self-check before output.
Output strict JSON matching schema/resume-output.schema.json.
</instructions>`;
}

function buildV2CoverPromptTemplateMd(): string {
  return `<task>Generate a tailored cover letter for this role.</task>

<job>
- Title: {{JOB_TITLE}}
- Company: {{COMPANY}}
- Description:
{{JOB_DESCRIPTION}}
</job>

<instructions>
Follow the cover-skill.md rules. Run quality-gates.md self-check before output.
Output strict JSON matching schema/cover-output.schema.json.
</instructions>`;
}

function buildV2PlatformNotesMd(): string {
  return `# Platform Import Notes

## Claude Projects
1. Create a new Project in Claude.
2. Upload all files from this skill pack as Project Knowledge.
3. The system.md and skill files will guide Claude's behavior automatically.
4. Use the prompt templates from prompts/ when providing job descriptions.

## Custom GPTs (OpenAI)
1. Create a new GPT in the GPT Builder.
2. Paste instructions/system.md content into the Instructions field.
3. Upload schema files and rules as Knowledge files.
4. Use the prompt templates as conversation starters.

## Gemini (Google)
1. Open Google AI Studio or Gemini Advanced.
2. Paste instructions/system.md as a system instruction.
3. Attach rules and schema files as context.
4. Use the prompt templates when submitting job descriptions.

## General Tips
- Always include the resume snapshot (context/) for personalized tailoring.
- The quality-gates.md file helps the AI self-validate before returning output.
- Schema files enforce strict output structure for Jobflow import compatibility.`;
}

function buildV2ReadmeMd(locale: "en-AU" | "zh-CN"): string {
  return `# Jobflow Skills V2

Structured skill pack for AI-powered resume and cover letter tailoring.

## Quick Start

1. Choose your AI platform (Claude Projects, Custom GPTs, Gemini, or any LLM).
2. Upload the files from this pack as context/knowledge.
3. Replace placeholders in prompt templates with your job data:
   - \`{{JOB_TITLE}}\` - Target role title
   - \`{{COMPANY}}\` - Target company name
   - \`{{JOB_DESCRIPTION}}\` - Full job description text
4. Submit the prompt and paste the resulting JSON back into Jobflow.

## Pack Structure

- **instructions/** - System prompt, skill definitions, and quality gates
- **rules/** - Categorized rules in JSON format with locale overrides
- **schema/** - JSON Schema for validating output
- **examples/** - Sample outputs (placeholder stubs)
- **context/** - Resume snapshot data (when included)
- **prompts/** - Job-specific prompt templates with placeholders
- **meta/** - Manifest and platform-specific import notes

## Locale

This pack is configured for: ${locale}

## Version

2.0.0 (2026-03-31)
`;
}

function buildV2ChangelogMd(): string {
  return `# Changelog

## 2.0.0 (2026-03-31)

- Redesigned skill pack with categorized rules and XML-tagged prompts
- Added self-validation quality gates
- Added zh-CN locale support
- Switched to ZIP format
- Added realistic full examples
- Separated resume and cover skill definitions
- Added JSON Schema validation files
- Added platform import notes for Claude, GPTs, and Gemini
`;
}

export function buildSkillPackV2Files(
  rules: StructuredRuleSet,
  context?: SkillPackContext,
  options?: SkillPackV2Options,
): { name: string; content: string }[] {
  const locale = options?.locale ?? rules.locale;
  const prefix = "jobflow-skills-v2";

  // Root-level SKILL.md required by Claude skill upload format
  const rootSkillMd = [
    "---",
    "name: jobflow-tailoring",
    "description: Generate role-tailored CVs and cover letters from a resume snapshot. Produces strict JSON for Jobflow PDF rendering. Supports en-AU and zh-CN locales.",
    "---",
    "",
    "# Jobflow Tailoring Skill",
    "",
    "Use when a job description is provided and tailored CV or Cover Letter JSON is needed for Jobflow import.",
    "",
    "## Required Inputs",
    "- Job title, company, and full job description",
    "- Resume snapshot (loaded from context/resume-snapshot.json)",
    "- Target: `resume` or `cover`",
    "",
    "## How to Use",
    "1. Load this skill pack into your AI project",
    "2. For each job application, paste the job-specific prompt from Jobflow",
    "3. The AI produces strict JSON matching the output schema",
    "4. Paste the JSON back into Jobflow to render the PDF",
    "",
    "## Key Rules",
    "- Every claim must be grounded in the resume snapshot — no fabrication",
    "- Output strict JSON only (no code fences, no markdown outside JSON)",
    "- Bold JD-critical keywords with **keyword** markers",
    "- Run the quality gates self-check before returning output",
    "",
    `## Pack Version: ${rules.version}`,
    `## Locale: ${locale}`,
    "",
    "See instructions/ for detailed rules, schema/ for output format, examples/ for reference output.",
  ].join("\n");

  const files: { name: string; content: string }[] = [
    // Root SKILL.md (required by Claude skill upload)
    { name: "SKILL.md", content: rootSkillMd },

    // Nested pack files
    { name: `${prefix}/README.md`, content: buildV2ReadmeMd(locale) },
    { name: `${prefix}/CHANGELOG.md`, content: buildV2ChangelogMd() },

    // Instructions
    { name: `${prefix}/instructions/system.md`, content: buildV2SystemMd(locale) },
    {
      name: `${prefix}/instructions/resume-skill.md`,
      content: buildV2ResumeSkillMd(rules.rules),
    },
    {
      name: `${prefix}/instructions/cover-skill.md`,
      content: buildV2CoverSkillMd(rules.rules),
    },
    {
      name: `${prefix}/instructions/quality-gates.md`,
      content: buildV2QualityGatesMd(locale),
    },

    // Rules
    {
      name: `${prefix}/rules/resume-rules.json`,
      content: buildRulesJson("resume", rules.rules),
    },
    {
      name: `${prefix}/rules/cover-rules.json`,
      content: buildRulesJson("cover", rules.rules),
    },
    {
      name: `${prefix}/rules/hard-constraints.json`,
      content: buildHardConstraintsJson(rules.hardConstraints),
    },
    {
      name: `${prefix}/rules/locale/en-AU.json`,
      content: buildLocaleJson("en-AU"),
    },
    {
      name: `${prefix}/rules/locale/zh-CN.json`,
      content: buildLocaleJson("zh-CN"),
    },

    // Schema
    {
      name: `${prefix}/schema/resume-output.schema.json`,
      content: JSON.stringify(getExpectedJsonSchemaForTarget("resume"), null, 2),
    },
    {
      name: `${prefix}/schema/cover-output.schema.json`,
      content: JSON.stringify(getExpectedJsonSchemaForTarget("cover"), null, 2),
    },

    // Examples
    {
      name: `${prefix}/examples/resume-output.full.json`,
      content: buildRealisticResumeExample(locale),
    },
    {
      name: `${prefix}/examples/resume-output.annotated.md`,
      content: buildAnnotatedResumeWalkthrough(locale),
    },
    {
      name: `${prefix}/examples/cover-output.full.json`,
      content: buildRealisticCoverExample(locale),
    },
    {
      name: `${prefix}/examples/cover-output.annotated.md`,
      content: buildAnnotatedCoverWalkthrough(locale),
    },

    // Prompts
    {
      name: `${prefix}/prompts/resume-job-prompt.template.md`,
      content: buildV2ResumePromptTemplateMd(),
    },
    {
      name: `${prefix}/prompts/cover-job-prompt.template.md`,
      content: buildV2CoverPromptTemplateMd(),
    },

    // Meta
    {
      name: `${prefix}/meta/platform-notes.md`,
      content: buildV2PlatformNotesMd(),
    },
  ];

  // Context (optional)
  if (context) {
    const snapshot = options?.redactContext
      ? redactResumeSnapshot(context.resumeSnapshot)
      : context.resumeSnapshot ?? {};

    files.push({
      name: `${prefix}/context/resume-snapshot.json`,
      content: JSON.stringify(snapshot, null, 2),
    });
    files.push({
      name: `${prefix}/context/snapshot-meta.json`,
      content: JSON.stringify(
        {
          resumeSnapshotUpdatedAt: context.resumeSnapshotUpdatedAt,
          redacted: !!options?.redactContext,
        },
        null,
        2,
      ),
    });
  }

  // Manifest (always last so file list is complete)
  const fileList = files.map((f) => f.name).concat(`${prefix}/meta/manifest.json`);
  const manifest = {
    packName: "jobflow-skills-v2",
    packVersion: "2.0.0",
    locale,
    generatedAt: new Date().toISOString(),
    files: fileList,
  };
  files.push({
    name: `${prefix}/meta/manifest.json`,
    content: JSON.stringify(manifest, null, 2),
  });

  return files;
}

