import { getLocaleProfile } from "@/lib/shared/locales";

/**
 * Build LLM-readable resume quality gate checklist.
 * Embedded in prompts so the external AI can self-validate before returning output.
 */
export function buildEmbeddedResumeQualityGates(): string {
  return [
    "## Resume Quality Gates (self-check before returning)",
    "",
    "Run each gate. If any gate FAILS, fix the output before returning.",
    "",
    "1. **BULLET_PRESERVATION**: Every base latest-experience bullet from the input appears verbatim in `latestExperience.bullets` (exact text match, no paraphrase, no omission). Reordering is allowed; deletion or rewording is not.",
    "",
    "2. **GROUNDING**: No new bullet references skills, tools, metrics, employers, or responsibilities that do not appear anywhere in the provided resume snapshot. Every claim must trace back to explicit evidence in the candidate context.",
    "",
    "3. **ADDITION_COUNT**: When top-3 responsibility gaps exist AND base resume evidence supports additions: add 2-3 new bullets (no fewer, no more). When all top-3 responsibilities are already covered by base bullets: add 0 new bullets (reorder only).",
    "",
    "4. **BOLD_MARKERS**: Every new bullet AND the `cvSummary` field contain at least one clean **keyword** bold marker for JD-critical terms. Markers must be clean: `**keyword**` with no inner spaces and no nested markers.",
    "",
    "5. **SKILLS_COMPLETE**: `skillsFinal` is the complete final skills list (not a delta or additions-only list). It contains at most 5 categories, each with `{ label, items }`. Categories are ordered by JD relevance priority (most important first).",
    "",
    "6. **SEMANTIC_DEDUP**: No two bullets in the final list cover the same theme or achievement. If two bullets both address 'performance optimization' or 'team leadership', keep only the stronger one.",
    "",
    "7. **STRONG_VERBS**: Every new bullet starts with a strong, specific action verb (Led, Architected, Shipped, Designed, Migrated, Optimized, Automated, Implemented, Drove, Delivered). Reject: Helped, Assisted, Worked on, Was responsible for, Participated in.",
    "",
    "8. **JSON_VALID**: Output is strict JSON matching the required schema. No code fences (` ``` `), no markdown prose outside JSON string values, no trailing commas, no comments. Use `\\n` for line breaks within string values.",
  ].join("\n");
}

/**
 * Build LLM-readable cover quality gate checklist.
 * Locale-aware for word count thresholds.
 */
export function buildEmbeddedCoverQualityGates(
  locale: "en-AU" | "zh-CN" = "en-AU",
): string {
  const profile = getLocaleProfile(locale);
  const { min, max } = profile.coverWordRange;

  return [
    "## Cover Letter Quality Gates (self-check before returning)",
    "",
    "Run each gate. If any gate FAILS, fix the output before returning.",
    "",
    `1. **MISSING_STRUCTURE**: The cover contains three substantial paragraphs: \`paragraphOne\` (>=60 chars), \`paragraphTwo\` (>=90 chars), \`paragraphThree\` (>=60 chars). None may be empty or trivially short.`,
    "",
    `2. **WORD_COUNT_RANGE**: Total word count across the three paragraphs is within ${min}-${max} words (locale: ${locale}). Count words after stripping markdown bold markers.`,
    "",
    "3. **TOP_RESPONSIBILITY_COVERAGE**: `paragraphTwo` explicitly addresses at least 2 of the top-3 JD responsibilities. Each must be identifiable by keyword or specific description, not vague allusion.",
    "",
    "4. **EVIDENCE_GROUNDING**: Claims made in `paragraphOne` and `paragraphTwo` overlap with at least 3 distinct keywords or phrases from the candidate's resume evidence. No fabricated achievements, metrics, or employer names.",
    "",
    "5. **KEYWORD_BOLDING**: At least 3 JD-critical keywords are bolded with clean `**keyword**` markers across the three paragraphs. Markers must be clean: no inner spaces, no nested markers.",
    "",
    "6. **GENERIC_MOTIVATION**: `paragraphThree` mentions the company name OR a specific JD topic, product, or team by name. It must not be a generic closing that could apply to any company.",
    "",
    "7. **FORWARD_CONTRIBUTION**: `paragraphThree` includes a forward-looking contribution statement — not just why you like the company, but what you will bring. Must contain language like 'I'd bring...', 'I'd apply my...', 'I'd contribute...', or equivalent.",
    "",
    "8. **CALL_TO_ACTION**: The closing sentence of `paragraphThree` contains a professional call to action (e.g., 'I'd welcome the opportunity to discuss...'). Reject passive endings like 'I hope to hear from you' or 'Thank you for your consideration.'",
  ].join("\n");
}

/**
 * Build combined quality gates document for skill pack embedding.
 * Includes both resume and cover gates with usage instructions.
 */
export function buildQualityGatesDocument(
  locale: "en-AU" | "zh-CN" = "en-AU",
): string {
  return [
    "# Quality Gates — Self-Validation Checklist",
    "",
    "Before returning your final JSON output, run the applicable quality gates below.",
    "If any gate fails, revise your output until all gates pass.",
    "Do NOT include gate results in your output — just ensure compliance.",
    "",
    "---",
    "",
    buildEmbeddedResumeQualityGates(),
    "",
    "---",
    "",
    buildEmbeddedCoverQualityGates(locale),
  ].join("\n");
}
