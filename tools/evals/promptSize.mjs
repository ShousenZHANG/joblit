/**
 * Measure a built prompt without sending it anywhere.
 *
 * Prompt slimming was previously judged from one hand-run measurement pasted
 * into a note, which went stale the first time a block moved. These two
 * functions make the number reproducible, and `runEval --dry-run` runs them
 * over the same job-and-profile matrix a real eval uses, so the size of a cut
 * can be established before any of the operator's model quota is spent on
 * whether the cut was safe.
 */

/**
 * Split a prompt into its XML-tagged blocks, measuring each with its own tags.
 *
 * The pattern requires the closing tag to match the opener by backreference,
 * so a tag named inside a block's prose (the rules mention `<skill-bank>`)
 * cannot end the block it appears in.
 */
export function promptSections(prompt) {
  const sections = [];
  const block = /<([a-z-]+)>\n([\s\S]*?)\n<\/\1>/g;
  let match = block.exec(prompt);
  while (match !== null) {
    sections.push({ tag: match[1], chars: match[0].length });
    match = block.exec(prompt);
  }
  return sections;
}

/**
 * Mean size and mean share per section across every measured case.
 *
 * A section missing from a case counts as zero for that case rather than being
 * skipped: `<coverage-analysis>` is absent whenever the caller passes no
 * coverage, and averaging only over the cases that carry a block would report
 * a share the run does not actually pay.
 */
export function summarisePromptSizes(cases) {
  if (cases.length === 0) return null;

  const totals = cases.map((entry) => entry.total);
  const perTag = new Map();
  for (const entry of cases) {
    for (const section of entry.sections) {
      perTag.set(section.tag, (perTag.get(section.tag) ?? 0) + section.chars);
    }
  }

  const meanTotal = totals.reduce((sum, value) => sum + value, 0) / cases.length;
  const sections = [...perTag]
    .map(([tag, chars]) => ({
      tag,
      meanChars: chars / cases.length,
      meanShare: chars / cases.length / meanTotal,
    }))
    .sort((a, b) => b.meanChars - a.meanChars);

  return {
    cases: cases.length,
    meanTotal,
    minTotal: Math.min(...totals),
    maxTotal: Math.max(...totals),
    sections,
  };
}
