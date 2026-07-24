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
    "1. **ADDITIONS_ONLY**: `latestExperience.addedBullets` contains only new, grounded bullet proposals. Do not copy, rewrite, remove, or return any existing Master Resume bullet.",
    "",
    "2. **GROUNDING**: No added bullet references skills, tools, metrics, employers, or responsibilities that do not appear anywhere in the provided resume snapshot. Every claim must trace back to explicit evidence in the candidate context.",
    "",
    "3. **ADDITION_COUNT**: Return zero to three added bullets. When coverage gaps exist AND grounded evidence supports additions, add only as many bullets as those gaps warrant. When the top-3 responsibilities are already covered, return an empty `addedBullets` array. Never fabricate a bullet to meet a count target.",
    "",
    "4. **BOLD_MARKERS**: Every added bullet AND the `cvSummary` field contain at least one clean **keyword** bold marker for JD-critical terms. Markers must be clean: `**keyword**` with no inner spaces and no nested markers.",
    "",
    "5. **SEMANTIC_DEDUP**: No added bullet duplicates the meaning of an existing Master Resume bullet or another proposed addition. Keep only genuinely additive evidence.",
    "",
    "6. **STRONG_VERBS**: Every added bullet starts with a strong, specific action verb (Led, Architected, Shipped, Designed, Migrated, Optimized, Automated, Implemented, Drove, Delivered). Reject: Helped, Assisted, Worked on, Was responsible for, Participated in.",
    "",
    "7. **BULLET_LENGTH**: Each added bullet is under 200 characters for ATS safety. No bullet exceeds 250 characters.",
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
    "7. **FORWARD_CONTRIBUTION**: `paragraphThree` includes a forward-looking contribution statement — not just why you like the company, but what you will bring. Must contain language like 'I'd bring...', 'I'd apply my...', 'I'd contribute...', 'I'd welcome the chance to apply...', or equivalent.",
    "",
    "8. **CALL_TO_ACTION**: The closing sentence of `paragraphThree` contains a professional call to action (e.g., 'I'd welcome the opportunity to discuss...', 'Happy to walk through specific examples...'). Reject passive endings like 'I hope to hear from you' or 'Thank you for your consideration.'",
    "",
    "9. **PARAGRAPH_BALANCE**: No single paragraph exceeds 800 characters. The three paragraphs should be roughly balanced — paragraphTwo may be the longest (evidence section) but not more than 2x the shortest paragraph.",
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
