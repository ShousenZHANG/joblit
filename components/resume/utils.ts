export function hasContent(value: string): boolean {
  return value.trim().length > 0;
}

export function hasBullets(items: string[]): boolean {
  return items.some((item) => hasContent(item));
}

export function normalizeBullets(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

const BRACKET_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Split a comma-separated skills line, ignoring commas inside brackets.
 *
 * The comma is both the separator and a legal character inside a skill name —
 * "Copilot Studio (Agents, Flows, Skills)" is one product, not three skills.
 * A plain `split(",")` shattered it, and the fragments reached the PDF and the
 * tailoring prompt, where they were offered to the model as separately
 * selectable skills.
 *
 * Nesting is tracked as a stack so an inner bracket cannot close an outer one.
 * An unclosed bracket keeps the rest of the line as a single item rather than
 * discarding it: that input is a half-typed entry, and losing the tail while
 * someone is still typing is worse than one temporarily long item.
 */
export function normalizeCommaItems(text: string): string[] {
  const items: string[] = [];
  const open: string[] = [];
  let current = "";

  for (const char of text) {
    if (char === "," && open.length === 0) {
      items.push(current);
      current = "";
      continue;
    }
    if (BRACKET_PAIRS[char]) open.push(BRACKET_PAIRS[char]);
    else if (open.at(-1) === char) open.pop();
    current += char;
  }
  items.push(current);

  return items.map((item) => item.trim()).filter(Boolean);
}

