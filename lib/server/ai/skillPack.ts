import type { StructuredRuleSet, SkillRule } from "@/lib/server/ai/promptSkills";
import { flattenStructuredRules } from "@/lib/server/ai/promptSkills";
import {
  PROMPT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
  getExpectedJsonSchemaForTarget,
} from "@/lib/server/ai/promptContract";
import {
  buildV2SystemPrompt,
  buildV2ResumeUserPrompt,
  buildV2CoverUserPrompt,
  getTemplateResumePromptInput,
} from "@/lib/server/ai/applicationPromptBuilder";
import { buildQualityGatesDocument } from "@/lib/server/ai/qualityGatesEmbed";
import { getLocaleProfile } from "@/lib/shared/locales";
import {
  buildRealisticResumeExample,
  buildAnnotatedResumeWalkthrough,
  buildRealisticCoverExample,
  buildAnnotatedCoverWalkthrough,
} from "@/lib/server/ai/skillPackExamples";
import {
  SKILL_PACK_VALIDATOR_MJS,
  SKILL_PACK_VALIDATOR_README,
} from "@/lib/server/ai/skillPackValidatorScript";

type SkillPackContext = {
  resumeSnapshot: unknown;
  resumeSnapshotUpdatedAt: string;
};

type SkillPackV2Options = {
  locale?: "en-AU" | "zh-CN";
  redactContext?: boolean;
};

// Stable build stamp so the same inputs produce byte-identical pack files
// (deterministic ZIP). The per-pack identity that actually changes with rules
// or resume edits is the skillPackVersion hash carried in the response header.
const SKILL_PACK_BUILD_STAMP = `${PROMPT_TEMPLATE_VERSION}+${PROMPT_SCHEMA_VERSION}`;

// Placeholder job used when rendering the pack's prompt templates. Real values
// are substituted by Joblit per job; here they stay as {{TOKENS}} the user
// (or Joblit's short prompt) fills in.
const PLACEHOLDER_JOB = {
  title: "{{JOB_TITLE}}",
  company: "{{COMPANY}}",
  description: "{{JOB_DESCRIPTION}}",
};

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

function filterRulesByTarget(rules: SkillRule[], target: "resume" | "cover"): SkillRule[] {
  return rules.filter((r) => r.appliesTo.includes(target));
}

function buildRulesJson(target: "resume" | "cover", rules: SkillRule[]): string {
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

function buildV2PlatformNotesMd(): string {
  return `# Platform Import Notes

## Claude (Projects / Skills)
1. Create a new Project, or upload this folder as a Skill.
2. Upload all files as Project Knowledge (instructions/, schema/, examples/, rules/, context/).
3. instructions/system.md is the system prompt; prompts/*.template.md are the job prompts.
4. Replace {{JOB_TITLE}} / {{COMPANY}} / {{JOB_DESCRIPTION}} with the real job.

## Custom GPTs (OpenAI)
1. Create a new GPT in the GPT Builder.
2. Paste instructions/system.md into the Instructions field.
3. Upload schema/, rules/, and examples/ as Knowledge files.
4. Use prompts/*.template.md as conversation starters.

## Gemini (Google)
1. Open Google AI Studio or Gemini Advanced.
2. Paste instructions/system.md as the system instruction.
3. Attach rules/ and schema/ files as context.
4. Use prompts/*.template.md when submitting a job.

## General Tips
- Always include the resume snapshot (context/) for personalised tailoring.
- Run \`node scripts/validate.mjs <output.json> --target=resume\` before importing.
- Schema files enforce strict output structure for Joblit import compatibility.`;
}

function buildV2ReadmeMd(locale: "en-AU" | "zh-CN"): string {
  return `# Joblit Skills V2

Structured skill pack for AI-powered resume and cover letter tailoring. The
behaviour here is the SAME spec Joblit's app uses when you click Generate —
instructions/ and prompts/ are rendered from Joblit's canonical prompt builder,
so the pack never drifts from the in-app prompt.

## Quick Start

1. Choose your AI platform (Claude, Custom GPTs, Gemini, or any LLM).
2. Upload the files from this pack as context/knowledge.
3. Replace placeholders in prompts/ with your job data:
   - \`{{JOB_TITLE}}\` — Target role title
   - \`{{COMPANY}}\` — Target company name
   - \`{{JOB_DESCRIPTION}}\` — Full job description text
4. Run \`node scripts/validate.mjs <output.json> --target=resume\` on the result.
5. Paste the validated JSON back into Joblit.

## Pack Structure

- **instructions/** — Canonical system prompt + quality-gates self-check
- **prompts/** — Canonical job prompt templates (resume / cover) with placeholders
- **rules/** — Categorised rules in JSON with locale overrides
- **schema/** — JSON Schema for validating output
- **scripts/** — Zero-dependency \`validate.mjs\` output checker
- **examples/** — Realistic full outputs + annotated walkthroughs
- **context/** — Resume snapshot data (when included)
- **meta/** — Manifest and platform-specific import notes

## Locale

This pack is configured for: ${locale}
`;
}

function buildV2ChangelogMd(): string {
  return `# Changelog

## 2.1.0

- Single source of truth: instructions/system.md, instructions/quality-gates.md,
  and prompts/*.template.md are now rendered from Joblit's canonical in-app
  prompt builder, so the pack can no longer drift from the live prompt.
- Added scripts/validate.mjs — a zero-dependency deterministic output validator
  that enforces the import contract locally.
- Removed the thinner duplicate skill definitions (rules now live inside the
  canonical prompt templates).
- Deterministic pack output (stable build stamp instead of a wall-clock time).

## 2.0.0

- Categorised rules and XML-tagged prompts; self-validation quality gates.
- zh-CN locale support; realistic full examples; JSON Schema validation files.
- Platform import notes for Claude, GPTs, and Gemini.
`;
}

/**
 * Build the V2 skill pack. The instruction/prompt files are rendered from the
 * SAME builders the in-app prompt (`POST /api/applications/prompt`) uses, so the
 * downloaded pack and the live prompt are a single source of truth.
 */
export function buildSkillPackV2Files(
  rules: StructuredRuleSet,
  context?: SkillPackContext,
  options?: SkillPackV2Options,
): { name: string; content: string }[] {
  const locale = options?.locale ?? rules.locale;
  const prefix = "joblit-skills-v2";

  // Flatten to the rule-set shape the canonical builders consume, then render
  // the exact in-app system prompt, quality gates, and job prompt templates.
  const flatRules = flattenStructuredRules(rules);
  const templateResume = getTemplateResumePromptInput([]);
  const systemMd = buildV2SystemPrompt(flatRules, locale);
  const qualityGatesMd = buildQualityGatesDocument(locale);
  const resumePromptTemplate = buildV2ResumeUserPrompt({
    target: "resume",
    rules: flatRules,
    job: PLACEHOLDER_JOB,
    resume: templateResume,
  });
  const coverPromptTemplate = buildV2CoverUserPrompt({
    target: "cover",
    rules: flatRules,
    job: PLACEHOLDER_JOB,
  });

  const rootSkillMd = [
    "---",
    "name: joblit-tailoring",
    "description: Generate role-tailored CVs and cover letters from a resume snapshot. Produces strict JSON for Joblit PDF rendering. Supports en-AU and zh-CN locales.",
    "---",
    "",
    "# Joblit Tailoring Skill",
    "",
    "Use when a job description is provided and tailored CV or Cover Letter JSON is needed for Joblit import.",
    "",
    "## Required Inputs",
    "- Job title, company, and full job description",
    "- Resume snapshot (loaded from context/resume-snapshot.json)",
    "- Target: `resume` or `cover`",
    "",
    "## How to Use",
    "1. Load this pack into your AI project (see meta/platform-notes.md).",
    "2. Use instructions/system.md as the system prompt.",
    "3. For each job, fill the placeholders in prompts/resume-job-prompt.template.md",
    "   or prompts/cover-job-prompt.template.md and send it.",
    "4. Validate the result: `node scripts/validate.mjs <output.json> --target=resume`.",
    "5. Paste the validated JSON back into Joblit to render the PDF.",
    "",
    "## Key Rules",
    "- Every claim must be grounded in the resume snapshot — no fabrication.",
    "- Output strict JSON only (no code fences, no markdown outside JSON).",
    "- Bold JD-critical keywords with **keyword** markers.",
    "- Run the quality gates self-check (instructions/quality-gates.md) before returning.",
    "",
    `## Pack Version: ${rules.version}`,
    `## Locale: ${locale}`,
    "",
    "instructions/ and prompts/ are rendered from Joblit's canonical prompt builder —",
    "this pack matches the in-app Generate prompt exactly.",
  ].join("\n");

  const files: { name: string; content: string }[] = [
    // Root SKILL.md (required by Claude skill upload)
    { name: "SKILL.md", content: rootSkillMd },

    { name: `${prefix}/README.md`, content: buildV2ReadmeMd(locale) },
    { name: `${prefix}/CHANGELOG.md`, content: buildV2ChangelogMd() },

    // Instructions — canonical (same as in-app prompt)
    { name: `${prefix}/instructions/system.md`, content: systemMd },
    { name: `${prefix}/instructions/quality-gates.md`, content: qualityGatesMd },

    // Prompts — canonical job prompt templates with placeholders
    { name: `${prefix}/prompts/resume-job-prompt.template.md`, content: resumePromptTemplate },
    { name: `${prefix}/prompts/cover-job-prompt.template.md`, content: coverPromptTemplate },

    // Rules (machine-readable references)
    { name: `${prefix}/rules/resume-rules.json`, content: buildRulesJson("resume", rules.rules) },
    { name: `${prefix}/rules/cover-rules.json`, content: buildRulesJson("cover", rules.rules) },
    { name: `${prefix}/rules/hard-constraints.json`, content: buildHardConstraintsJson(rules.hardConstraints) },
    { name: `${prefix}/rules/locale/en-AU.json`, content: buildLocaleJson("en-AU") },
    { name: `${prefix}/rules/locale/zh-CN.json`, content: buildLocaleJson("zh-CN") },

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
    { name: `${prefix}/examples/resume-output.full.json`, content: buildRealisticResumeExample(locale) },
    { name: `${prefix}/examples/resume-output.annotated.md`, content: buildAnnotatedResumeWalkthrough(locale) },
    { name: `${prefix}/examples/cover-output.full.json`, content: buildRealisticCoverExample(locale) },
    { name: `${prefix}/examples/cover-output.annotated.md`, content: buildAnnotatedCoverWalkthrough(locale) },

    // Scripts — deterministic output validator
    { name: `${prefix}/scripts/validate.mjs`, content: SKILL_PACK_VALIDATOR_MJS },
    { name: `${prefix}/scripts/README.md`, content: SKILL_PACK_VALIDATOR_README },

    // Meta
    { name: `${prefix}/meta/platform-notes.md`, content: buildV2PlatformNotesMd() },
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

  // Manifest (always last so the file list is complete). generatedAt uses a
  // stable build stamp, not wall-clock, so identical inputs yield identical bytes.
  const fileList = files.map((f) => f.name).concat(`${prefix}/meta/manifest.json`);
  const manifest = {
    packName: "joblit-skills-v2",
    packVersion: rules.version,
    locale,
    buildStamp: SKILL_PACK_BUILD_STAMP,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    schemaVersion: PROMPT_SCHEMA_VERSION,
    redacted: !!options?.redactContext,
    files: fileList,
  };
  files.push({
    name: `${prefix}/meta/manifest.json`,
    content: JSON.stringify(manifest, null, 2),
  });

  return files;
}
