import {
  PROMPT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
} from "@/lib/server/ai/promptContract";

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

/**
 * Generate the README.md for the skill pack.
 */
export function buildReadme(version: string, locale: "en-AU" | "zh-CN"): string {
  const localeLabel = locale === "zh-CN" ? "zh-CN (Simplified Chinese)" : "en-AU (Australian English)";

  return `# Jobflow Tailoring Skill Pack v${version}

> Production-grade AI skill pack for generating role-tailored CVs and cover letters.

- Prompt template version: ${PROMPT_TEMPLATE_VERSION}
- Output schema version: ${PROMPT_SCHEMA_VERSION}
- Locale: ${localeLabel}

## Quick Start

### 1. Import into your AI platform

**Claude Projects:**
1. Create a new Project (or open existing)
2. Go to Project Knowledge > Add content
3. Upload all files from \`instructions/\`, \`rules/\`, \`schema/\`, and \`examples/\`
4. Upload \`context/resume-snapshot.json\` (your resume data)

**Custom GPTs:**
1. Go to GPT Builder > Configure > Knowledge
2. Upload the same files listed above

**Gemini:**
1. Start a new conversation
2. Upload \`instructions/system.md\` and set as context
3. Upload remaining files as attachments

**Any LLM with file upload:**
1. Upload \`instructions/system.md\` as the system prompt
2. Upload all other files as context/knowledge
3. Proceed with the job prompt workflow below

### 2. Generate for each job

For each job application:
1. Copy the template from \`prompts/resume-user.txt\` or \`prompts/cover-user.txt\`
2. Replace \`{{JOB_TITLE}}\`, \`{{COMPANY}}\`, and \`{{JOB_DESCRIPTION}}\` with the actual job details
3. Paste into your AI chat
4. Copy the JSON output

### 3. Import back to Jobflow

1. In Jobflow Jobs page, click "Generate CV" or "Generate Cover Letter"
2. Choose "Import from external AI"
3. Paste the JSON output
4. Jobflow renders the PDF automatically

## Pack Contents

| Directory | Contents | Purpose |
|-----------|----------|---------|
| \`instructions/\` | SKILL.md | Trigger conditions, hard constraints, execution procedure, and verification checklist |
| \`prompts/\` | system.txt, resume-user.txt, cover-user.txt | System prompt and per-job user prompt templates with placeholders |
| \`rules/\` | cv-rules.md, cover-rules.md, hard-constraints.md | Detailed rule sets governing output quality |
| \`schema/\` | output.resume.schema.json, output.cover.schema.json | JSON Schema definitions the AI output must conform to |
| \`examples/\` | output.resume.full.json, output.cover.full.json, resume-walkthrough.md, cover-walkthrough.md | Realistic examples with annotated explanations |
| \`context/\` | resume-snapshot.json, resume-snapshot-updated-at.txt | Your resume data (the single source of truth) |
| \`meta/\` | manifest.json, prompt-contract.json | Pack metadata, versioning, and contract info |

## Output Contracts

The skill pack produces two types of output:

**Resume output** (\`output.resume.schema.json\`):
- \`cvSummary\`: Role-tailored professional summary with bolded JD keywords
- \`latestExperience.bullets\`: Complete ordered bullet list (base preserved + grounded additions)
- \`skillsFinal\`: Complete skills list in up to 5 categories, JD-priority ordered

**Cover letter output** (\`output.cover.schema.json\`):
- \`cover.paragraphOne\`: Application intent anchored in real experience
- \`cover.paragraphTwo\`: Evidence mapped to top JD responsibilities
- \`cover.paragraphThree\`: Company-specific motivation
- Plus metadata: candidateTitle, subject, date, salutation, closing, signatureName

## Tips

- Always use the latest resume snapshot when generating. Stale snapshots produce lower-quality tailoring.
- Review the annotated walkthroughs in \`examples/\` to understand what good output looks like.
- If the AI output does not parse as valid JSON, check for markdown code fences and strip them before importing.
- The schema files can be used as structured output constraints in platforms that support them (e.g. OpenAI function calling).
`;
}

// ---------------------------------------------------------------------------
// Platform Notes
// ---------------------------------------------------------------------------

/**
 * Generate platform-specific import notes.
 */
export function buildPlatformNotes(): string {
  return `# Platform Import Guide

## Claude Projects

Claude Projects is the recommended platform for skill pack usage.

### Setup
1. Go to claude.ai > Projects > New Project (or open existing)
2. Click "Project Knowledge" in the sidebar
3. Click "Add content" > "Upload files"
4. Upload the following files in order:
   - \`instructions/SKILL.md\` (the AI reads this to understand its task)
   - \`rules/cv-rules.md\`, \`rules/cover-rules.md\`, \`rules/hard-constraints.md\`
   - \`schema/output.resume.schema.json\`, \`schema/output.cover.schema.json\`
   - \`examples/output.resume.full.json\`, \`examples/output.cover.full.json\`
   - \`examples/resume-walkthrough.md\`, \`examples/cover-walkthrough.md\`
   - \`context/resume-snapshot.json\`
5. Optionally set \`prompts/system.txt\` as the Project Instructions

### Per-Job Usage
1. Start a new conversation within the project
2. Paste the content of \`prompts/resume-user.txt\` or \`prompts/cover-user.txt\`
3. Replace the three placeholders with actual job data
4. Send the message and wait for JSON output
5. Copy the JSON and import into Jobflow

---

## Custom GPTs (OpenAI)

### Setup
1. Go to chat.openai.com > Explore GPTs > Create a GPT
2. In the Configure tab:
   - Set the system instructions to the content of \`prompts/system.txt\`
   - Under Knowledge, upload: SKILL.md, all rules files, all schema files, all example files, and resume-snapshot.json
3. Save the GPT

### Per-Job Usage
1. Open your custom GPT
2. Paste the resume or cover user prompt template with placeholders filled in
3. Copy the JSON output and import into Jobflow

### Notes
- Custom GPTs support structured output via function calling. You can optionally define a function with the resume or cover schema to enforce valid JSON.
- Knowledge files have a size limit. If your resume snapshot is large, consider using the redacted version.

---

## Gemini (Google)

### Setup
1. Go to gemini.google.com
2. Start a new conversation
3. In your first message, paste the full content of \`prompts/system.txt\`
4. Upload \`instructions/SKILL.md\` and \`context/resume-snapshot.json\` as attachments
5. Optionally upload rule and schema files for additional grounding

### Per-Job Usage
1. In the same conversation, paste the resume or cover user prompt template
2. Replace placeholders with actual job data
3. Copy the JSON output and import into Jobflow

### Notes
- Gemini does not have a dedicated "system prompt" field in the web UI. Pasting system.txt as the first message achieves a similar effect.
- For Gemini API usage, set system.txt as the \`system_instruction\` parameter.

---

## Generic LLM (Any Platform)

For any LLM that accepts a system prompt and user messages:

1. **System prompt**: Use the content of \`prompts/system.txt\`
2. **Context**: Provide the content of \`instructions/SKILL.md\` and \`context/resume-snapshot.json\` as part of the conversation context (upload, paste, or include in system prompt)
3. **User message**: Use the resume or cover user prompt template with placeholders filled in
4. **Validation**: Validate the output JSON against the appropriate schema file before importing into Jobflow

### API Integration
If calling an LLM API programmatically:
- Set \`prompts/system.txt\` as the system message
- Include SKILL.md and resume-snapshot.json in the context window
- Use \`prompts/resume-user.txt\` or \`prompts/cover-user.txt\` (with placeholders replaced) as the user message
- Parse the response as JSON and validate against the schema
- Import the validated JSON into Jobflow via the UI or API
`;
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

/**
 * Generate changelog content.
 */
export function buildChangelog(): string {
  return `# Changelog

All notable changes to the Jobflow Tailoring Skill Pack are documented here.

## v2.0.0 — 2026-03-31

### Added
- Full realistic examples for both resume and cover letter output (en-AU and zh-CN)
- Annotated walkthroughs explaining the reasoning behind each output field
- Platform-specific import guides for Claude Projects, Custom GPTs, Gemini, and generic LLMs
- JSON Schema validation files for both resume and cover letter output contracts
- Skill pack manifest with version tracking and content hashing
- Structured \`skillsFinal\` output replacing the previous \`skillsAdditions\` delta format
- Google XYZ-style bullet guidance for newly added experience items
- Responsibility coverage mapping for cover letter paragraph 2
- Quality gate checklist embedded in SKILL.md verification section

### Changed
- Output contract now uses \`skillsFinal\` (complete final list) instead of \`skillsAdditions\` (delta)
- Cover letter structure formalised into three semantic paragraphs with distinct purposes
- Bold keyword marking uses clean markdown (**keyword**) with no inner whitespace
- Prompt templates generated from the same builder used by the Jobflow API

### Removed
- Deprecated \`skillsAdditions\` output field
- Legacy single-file prompt format

## v1.0.0 — 2026-01-15

### Added
- Initial skill pack with basic prompt templates
- Resume and cover letter generation support
- en-AU locale support
`;
}
