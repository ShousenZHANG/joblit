import type { PromptSkillRuleSet } from "@/lib/server/ai/promptSkills";
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

