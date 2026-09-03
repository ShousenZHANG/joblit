/**
 * Measure how much of the candidate's skill bank a tailored selection kept.
 *
 * Tailoring produces two things (ADR-0023): a rewritten summary and a skills
 * selection. The gates score the first one and say nothing about the second —
 * every index inside the bank is legal, and the schema's only ceiling is the
 * bank's own size (12 groups of 30). So a run can score 100% while the
 * "tailored" skills section is the master list in a different order, which is
 * what three hand-checked jobs suggested: 22/26, 15/26, 22/26 selected.
 *
 * There was no number for this in the eval trace. These two functions are it:
 * one ratio per case, and the mean across a run. Nothing here judges whether a
 * selection is *good* — that is a human's call — only how much of the bank
 * survived, which is the quantity a filtering rule would have to move.
 */

/**
 * Count the groups and items a selection actually resolves to.
 *
 * Indexes outside the bank are dropped rather than counted. A trace row is
 * written for rejected attempts too, and an out-of-range index is exactly what
 * `SKILLS_SELECTION_INVALID` rejects — counting it would inflate the breadth of
 * the runs that failed hardest.
 *
 * Returns `null` when there is nothing to measure. Zero would read as perfect
 * filtering, which is the opposite of "no selection was made".
 */
export function skillsBreadth(selection, bank) {
  if (!Array.isArray(selection) || selection.length === 0) return null;
  if (!Array.isArray(bank) || bank.length === 0) return null;

  const bankGroups = bank.length;
  const bankItems = bank.reduce(
    (total, group) => total + (Array.isArray(group?.items) ? group.items.length : 0),
    0,
  );
  if (bankItems === 0) return null;

  let groups = 0;
  let items = 0;
  for (const entry of selection) {
    const group = bank[entry?.group];
    if (!group || !Array.isArray(group.items)) continue;
    const valid = (Array.isArray(entry.items) ? entry.items : []).filter(
      (index) => Number.isInteger(index) && index >= 0 && index < group.items.length,
    ).length;
    if (valid === 0) continue;
    groups += 1;
    items += valid;
  }

  return { groups, items, bankGroups, bankItems, itemRatio: items / bankItems };
}

/**
 * Mean breadth across a run, over the rows that carried a selection.
 *
 * `fullBank` is the headline: the number of cases where tailoring dropped
 * nothing at all.
 */
export function summariseBreadth(rows) {
  const measured = rows.map((row) => row?.breadth).filter(Boolean);
  if (measured.length === 0) return null;

  const mean = (pick) =>
    measured.reduce((total, breadth) => total + pick(breadth), 0) / measured.length;

  return {
    measured: measured.length,
    meanItems: mean((b) => b.items),
    meanBankItems: mean((b) => b.bankItems),
    meanRatio: mean((b) => b.itemRatio),
    fullBank: measured.filter((b) => b.itemRatio === 1).length,
  };
}
