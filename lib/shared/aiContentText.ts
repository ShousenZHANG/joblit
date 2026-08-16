/**
 * The single rule for turning an AI proposal into the text that ships.
 *
 * Every consumer of `aiContent` — the LaTeX renderers, the review panel, the
 * document content hash — must agree on what a proposal's final text is,
 * because they describe the same document. Before this module the rule was
 * written eleven times and three of those copies disagreed: one retired
 * generator returned "" for an unaccepted cover paragraph while
 * `finalizeApplication` rendered it, so the same Application could produce two
 * different cover letters depending on which path built the PDF.
 *
 * The rule, stated once:
 *
 *   **`accepted` gates additions, not replacements.**
 *
 * The summary and the three cover paragraphs are replacements of required
 * content: a cover letter with a missing body paragraph is not a shorter cover
 * letter, it is an invalid one, and `finalizeApplication` rejects it with
 * COVER_PARAGRAPHS_INCOMPLETE. So rejecting a replacement cannot mean omitting
 * it — the user edits it instead, and `userEdit` already wins when present.
 *
 * Tailoring generates no additions any more, so `accepted` has no remaining
 * gate to perform; it is preserved on the row for provenance and deliberately
 * not read here.
 *
 * See CONTEXT.md → AI Content.
 */

/** A proposal that replaces required content: the summary, a cover paragraph. */
type Proposal = {
  aiText: string;
  userEdit?: string;
  /**
   * Carried by every real proposal and deliberately not read here — rejecting a
   * replacement cannot mean omitting it. Declared so the contract is visible at
   * the type level rather than only in prose.
   */
  accepted?: boolean;
};

/**
 * One group of the candidate's own skills. Only `items` is named because the
 * two shapes this runs against label the group differently — `category` on the
 * stored profile, `label` once escaped for LaTeX — and the selection addresses
 * items by position in either case.
 */
type SkillGroup = {
  items: readonly string[];
};

/** Index references into the master profile's skills. */
type SelectionGroup = {
  group: number;
  items: readonly number[];
};

/** The stored pair: what the model selected, and the user's override if any. */
type StoredSkillsSelection = {
  aiSelection: readonly SelectionGroup[];
  userSelection?: readonly SelectionGroup[];
};

/**
 * Final text for a replacement proposal. `accepted` is deliberately not read:
 * see the module note.
 */
export function proposalText(proposal: Proposal): string {
  return proposal.userEdit?.trim() || proposal.aiText.trim();
}

/** The three cover body paragraphs, in order. */
export function coverParagraphTexts(cover: {
  paragraphOne: Proposal;
  paragraphTwo: Proposal;
  paragraphThree: Proposal;
}): [string, string, string] {
  return [
    proposalText(cover.paragraphOne),
    proposalText(cover.paragraphTwo),
    proposalText(cover.paragraphThree),
  ];
}

/** The selection that ships: the user's when they have made one. */
export function effectiveSkillsSelection(
  selection: StoredSkillsSelection,
): readonly SelectionGroup[] {
  return selection.userSelection ?? selection.aiSelection;
}

/**
 * The skills section that ships, resolved against the candidate's own profile.
 *
 * A selection is only ever a set of index references, so resolving it can add
 * nothing: every string in the result was read out of `masterSkills`. Indexes
 * that no longer exist are skipped rather than throwing — a profile edit
 * between generation and finalize is a normal event, and the render context
 * fence already un-publishes the document when that happens, so the correct
 * behaviour here is to render what still resolves.
 *
 * Passing no selection (a draft written before tailoring selected skills)
 * returns the master profile unchanged.
 */
export function resolveSkillsSelection<T extends SkillGroup>(
  masterSkills: readonly T[],
  selection: StoredSkillsSelection | undefined,
): T[] {
  if (!selection) return [...masterSkills];

  return effectiveSkillsSelection(selection)
    .map((entry) => {
      const group = masterSkills[entry.group];
      if (!group) return null;
      const items = entry.items
        .map((index) => group.items[index])
        .filter((item): item is string => Boolean(item));
      if (!items.length) return null;
      return { ...group, items } as T;
    })
    .filter((group): group is T => group !== null);
}
