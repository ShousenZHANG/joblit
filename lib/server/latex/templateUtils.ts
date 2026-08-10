/**
 * Substitute a literal placeholder with literal replacement text.
 *
 * `String.prototype.replace` interprets `$` patterns in its REPLACEMENT
 * argument: `$&` re-inserts the match, `` $` `` inserts everything before it,
 * `$'` everything after. Rendered LaTeX is full of `\$` from escapeLatex, so a
 * resume or cover letter containing a plain "$" next to the wrong character
 * could splice the template's own preamble into the document body. Splitting
 * and joining takes no patterns at all.
 */
export function replaceLiteral(
  text: string,
  placeholder: string,
  replacement: string,
): string {
  const index = text.indexOf(placeholder);
  if (index === -1) return text;
  return (
    text.slice(0, index) + replacement + text.slice(index + placeholder.length)
  );
}

/** Replace {{KEY}} tokens in a LaTeX template string */
export function replaceTokens(
  text: string,
  map: Record<string, string>,
): string {
  let out = text;
  for (const [key, value] of Object.entries(map)) {
    const token = `{{${key}}}`;
    out = out.split(token).join(value);
  }
  return out;
}

/** Remove surrogate pairs, replacement chars, and emoji from rendered TeX */
export function sanitizeRendered(tex: string): string {
  return tex
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[\u{1F000}-\u{10FFFF}]/gu, "");
}

/** Render array of items as LaTeX \\item entries */
export function renderBullets(items: string[]): string {
  return items.map((item) => `\\item ${item}`).join("\n");
}

/** Render array of links as LaTeX \\href entries joined by separator */
export function renderLinks(
  links: Array<{ label: string; url: string }>,
  separator = " \\;|\\; ",
): string {
  if (links.length === 0) return "";
  return links
    .map((link) => `\\href{${link.url}}{${link.label}}`)
    .join(separator);
}
