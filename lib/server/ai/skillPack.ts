import { createHash } from "node:crypto";

import type { StructuredRuleSet, SkillRule } from "@/lib/server/ai/promptSkills";
import {
  flattenStructuredRules,
  SKILL_PACK_VERSION,
} from "@/lib/server/ai/promptSkills";
import {
  PROMPT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
  getExpectedJsonSchemaForTarget,
} from "@/lib/server/ai/promptContract";
import {
  buildV2SystemPrompt,
  buildV2ResumeUserPrompt,
  buildV2CoverUserPrompt,
} from "@/lib/server/ai/applicationPromptBuilder";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
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

type SkillPackV3Options = {
  locale?: "en-AU" | "zh-CN";
  redactContext?: boolean;
};

export type SkillPackFile = {
  name: string;
  content: string;
};

// Stable build stamp so the logical package files remain deterministic. ZIP
// timestamps are intentionally excluded from the content identity; the hash in
// the response header changes with the final packaged rules or resume content.
const SKILL_PACK_BUILD_STAMP = `${PROMPT_TEMPLATE_VERSION}+${PROMPT_SCHEMA_VERSION}`;
const SKILL_PACK_PREFIX = "joblit-skills-v3";

/**
 * Content identity for a downloadable Skill Pack.
 *
 * This is intentionally independent of ZIP metadata and input order: it hashes
 * the final logical file names and bytes after sorting by name. Any rule,
 * schema, prompt, context, example, validator, or manifest change therefore
 * produces a different download receipt.
 */
export function buildSkillPackContentVersion(
  files: readonly SkillPackFile[],
): string {
  const canonicalFiles = [...files]
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .map(({ name, content }) => [name, content]);
  return createHash("sha256")
    .update(JSON.stringify(canonicalFiles))
    .digest("hex");
}

// Placeholder job used when rendering the pack's prompt templates. Real values
// are substituted by Joblit per job; here they stay as {{TOKENS}} the user
// (or Joblit's short prompt) fills in.
const PLACEHOLDER_JOB = {
  title: "{{JOB_TITLE}}",
  company: "{{COMPANY}}",
  description: "{{JOB_DESCRIPTION}}",
};

const PLACEHOLDER_RESUME_SNAPSHOT = {
  basics: {
    fullName: "{{CANDIDATE_NAME}}",
    title: "{{CANDIDATE_TITLE}}",
  },
  summary: "{{RESUME_SUMMARY}}",
  skills: [],
  experiences: [],
  projects: [],
  education: [],
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
      version: SKILL_PACK_VERSION,
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
      version: SKILL_PACK_VERSION,
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

function buildV3PlatformNotesMd(): string {
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

function buildV3ReadmeMd(locale: "en-AU" | "zh-CN"): string {
  return `# Joblit Skills V3

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

function buildV3ChangelogMd(): string {
  return `# Changelog

## 3.0.0

- Resume output is delta-only: \`cvSummary\` plus zero to three
  \`latestExperience.addedBullets\`; skills remain Master Resume Profile-owned.
- Cover output contains only the three body paragraphs.
- Downloaded packs use the user's active effective rule template and a
  deterministic content version over every final logical file.

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
 * Build the V3 skill pack. The instruction/prompt files are rendered from the
 * SAME builders the in-app prompt (`POST /api/applications/prompt`) uses, so the
 * downloaded pack and the live prompt are a single source of truth.
 */
export function buildSkillPackV3Files(
  rules: StructuredRuleSet,
  context?: SkillPackContext,
  options?: SkillPackV3Options,
): SkillPackFile[] {
  const locale = options?.locale ?? rules.locale;
  const prefix = SKILL_PACK_PREFIX;

  // Flatten to the rule-set shape the canonical builders consume, then render
  // the exact in-app system prompt, quality gates, and job prompt templates.
  const flatRules = flattenStructuredRules(rules);
  const candidateSnapshot = buildResumePromptSnapshot(
    context
      ? options?.redactContext
        ? redactResumeSnapshot(context.resumeSnapshot)
        : context.resumeSnapshot
      : PLACEHOLDER_RESUME_SNAPSHOT,
  );
  const systemMd = buildV2SystemPrompt(flatRules, locale);
  const qualityGatesMd = buildQualityGatesDocument(locale);
  const resumePromptTemplate = buildV2ResumeUserPrompt({
    target: "resume",
    rules: flatRules,
    candidate: candidateSnapshot,
    job: PLACEHOLDER_JOB,
  });
  const coverPromptTemplate = buildV2CoverUserPrompt({
    target: "cover",
    rules: flatRules,
    candidate: candidateSnapshot,
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
    `## Pack Version: ${SKILL_PACK_VERSION}`,
    `## Locale: ${locale}`,
    "",
    "instructions/ and prompts/ are rendered from Joblit's canonical prompt builder —",
    "this pack matches the in-app Generate prompt exactly.",
  ].join("\n");

  const files: SkillPackFile[] = [
    // Root SKILL.md (required by Claude skill upload)
    { name: "SKILL.md", content: rootSkillMd },

    { name: `${prefix}/README.md`, content: buildV3ReadmeMd(locale) },
    { name: `${prefix}/CHANGELOG.md`, content: buildV3ChangelogMd() },

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
    { name: `${prefix}/meta/platform-notes.md`, content: buildV3PlatformNotesMd() },
  ];

  // Context (optional)
  if (context) {
    files.push({
      name: `${prefix}/context/resume-snapshot.json`,
      content: JSON.stringify(candidateSnapshot, null, 2),
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
    packName: SKILL_PACK_PREFIX,
    packVersion: SKILL_PACK_VERSION,
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
