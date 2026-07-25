/**
 * The single rule for turning an AI proposal into the text that ships.
 *
 * Every consumer of `aiContent` — the LaTeX renderers, the evidence ledger, the
 * claim ledger — must agree on what a proposal's final text is, because they
 * describe the same document. Before this module the rule was written eleven
 * times and three of those copies disagreed:
 *
 *   - `generateApplicationArtifacts` returned "" for an unaccepted cover
 *     paragraph, while `finalizeApplication` rendered it. The same Application
 *     could produce two different cover letters depending on which path built
 *     the PDF.
 *   - `evidenceLedger` trimmed a bullet's user edit but not its `text`
 *     fallback; `persistReviewLedger` trimmed both. Evidence ids and persisted
 *     claims are derived from the same bullet and normalized it differently.
 *
 * The rule, stated once:
 *
 *   **`accepted` gates additions, not replacements.**
 *
 * An AI-added bullet is an addition — the user opts in, and an unaccepted
 * bullet is omitted. The summary and the three cover paragraphs are
 * replacements of required content: a cover letter with a missing body
 * paragraph is not a shorter cover letter, it is an invalid one, and
 * `finalizeApplication` rejects it with COVER_PARAGRAPHS_INCOMPLETE. So
 * rejecting a replacement cannot mean omitting it — the user edits it instead,
 * and `userEdit` already wins when present.
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

/** An AI-added bullet. Carries its draft in `text`, not `aiText`. */
type AddedBullet = {
  text: string;
  userEdit?: string;
};

/**
 * Final text for a replacement proposal. `accepted` is deliberately not read:
 * see the module note.
 */
export function proposalText(proposal: Proposal): string {
  return proposal.userEdit?.trim() || proposal.aiText.trim();
}

/** Final text for one AI-added bullet, regardless of whether it was accepted. */
export function addedBulletText(bullet: AddedBullet): string {
  return bullet.userEdit?.trim() || bullet.text.trim();
}

/**
 * The added bullets that belong in the rendered document, in order. Unaccepted
 * bullets are omitted; so is any bullet that is empty once trimmed, which would
 * otherwise render as a blank list item.
 */
export function acceptedAddedBulletTexts(
  bullets: readonly (AddedBullet & { accepted: boolean })[],
): string[] {
  return bullets
    .filter((bullet) => bullet.accepted)
    .map(addedBulletText)
    .filter(Boolean);
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
