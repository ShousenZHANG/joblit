/**
 * Separate a posting's role name from the metadata bolted onto the end of it.
 *
 * Feeds routinely ship a contract term inside the title:
 * "Application Developer - PowerApps (Fixed term Full Time Opportunity until
 * 30 June 2027)". Rendered as one run, the end date gets the same weight as
 * the role, and the role is what the reader is scanning for.
 *
 * The split is presentational only. Both halves stay inside the same heading
 * element, so the heading's accessible name is still the posted title and a
 * `getByRole("heading", { name })` query is unaffected.
 *
 * A short parenthetical is left alone: "(Contract)", "(m/f/d)" and "(AU)" read
 * as part of what the job is called rather than as posting metadata. The
 * threshold is length because there is no reliable vocabulary for the
 * difference — a keyword gate would need a list per market and would still
 * miss the next phrasing.
 */

/**
 * Inner text long enough to be a clause rather than a qualifier of the name.
 * "(Fixed term until 2027)" is 22; "(Contract)" is 8.
 */
const QUALIFIER_MIN_INNER_CHARS = 12;

/**
 * Anchored at the end, and `[^()]` means a nested or unbalanced parenthetical
 * cannot match — splitting one would produce a fragment on each side.
 * The leading `.*\S` guarantees a non-empty role name survives, so a title
 * that is nothing but a parenthetical is returned whole.
 */
const TRAILING_QUALIFIER = new RegExp(
  `^(.*\\S)\\s*(\\([^()]{${QUALIFIER_MIN_INNER_CHARS},}\\))$`,
);

export type TitleParts = {
  /** The role name, always non-empty when the title was. */
  main: string;
  /** The trailing parenthetical with its parentheses, or null. */
  qualifier: string | null;
};

export function splitTitleQualifier(title: string): TitleParts {
  const trimmed = title.trim();
  const match = TRAILING_QUALIFIER.exec(trimmed);
  if (!match) return { main: trimmed, qualifier: null };
  return { main: match[1], qualifier: match[2] };
}
