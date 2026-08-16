import { getLocaleProfile } from "@/lib/shared/locales";
import { CV_SUMMARY_LENGTH } from "@/lib/shared/schemas/applicationGenerationOutput";

/**
 * Build LLM-readable resume quality gate checklist.
 *
 * Embedded in prompts so the external AI can self-validate before returning
 * output. Every gate below mirrors a check Joblit runs on import — the summary
 * lint in `lib/server/ai/summaryLint.ts` and the index-bounds check in
 * `lib/server/applications/manualImportParser.ts` — so a model that passes its
 * own self-check is not about to be rejected by the server.
 */
export function buildEmbeddedResumeQualityGates(): string {
  return [
    "## Resume Quality Gates (self-check before returning)",
    "",
    "Run each gate. If any gate FAILS, fix the output before returning.",
    "",
    `1. **SUMMARY_LENGTH**: \`cvSummary\` is between ${CV_SUMMARY_LENGTH.min} and ${CV_SUMMARY_LENGTH.max} characters after trimming. Outside that window it is rejected outright.`,
    "",
    "2. **TITLE_PRESENT**: `cvSummary` contains the posting's role title (with seniority words and trailing qualifiers dropped) as a literal phrase. \"Senior AI Engineer - Platform\" requires the words \"AI Engineer\" to appear.",
    "",
    "3. **GROUNDED_NUMBERS**: Every number in `cvSummary` already appears in the resume snapshot. Do not round, extrapolate, combine, or invent a figure.",
    "",
    "4. **GROUNDED_SKILLS**: Every skill or technology named in `cvSummary` already appears in the resume snapshot. A near-neighbour of a real skill is still a fabrication.",
    "",
    "5. **NO_SENIORITY_INFLATION**: `cvSummary` claims no title, level, or years the snapshot's own dates and titles do not support.",
    "",
    "6. **SELECTION_INDEXES_ONLY**: `skillsSelection` contains integers only. No skill name, group name, or free text appears anywhere in it.",
    "",
    "7. **SELECTION_IN_BANK**: Every `group` and every entry of `items` exists in the numbered skill bank you were given. An index past the end of a group is rejected at import.",
    "",
    "8. **SELECTION_NO_DUPLICATES**: Each `group` appears at most once across `skillsSelection`, and each index appears at most once within its own `items`.",
    "",
    "9. **SELECTION_RELEVANCE_ORDER**: Groups and items are ordered most-relevant-to-this-posting first, and groups or items irrelevant to the posting are omitted. Array order is render order on the PDF.",
    "",
    "10. **SELECTION_NON_EMPTY**: At least one group with at least one item is returned.",
    "",
    "11. **BOLD_MARKERS**: `cvSummary` contains at least one clean **keyword** bold marker for a JD-critical term. Markers must be clean: `**keyword**` with no inner spaces and no nested markers.",
    "",
    "12. **JSON_VALID**: Output is strict JSON matching the required schema. No code fences (` ``` `), no markdown prose outside JSON string values, no trailing commas, no comments. Use `\\n` for line breaks within string values.",
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
