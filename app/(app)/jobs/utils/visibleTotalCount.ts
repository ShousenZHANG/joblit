/**
 * Server total for a filter, adjusted for rows hidden by an in-flight
 * (undo-window) delete.
 *
 * The single-job delete hides a row via `suppressedDeletedIds` WITHOUT mutating
 * the react-query cache during the undo window (so concurrent pending deletes
 * and a background refetch can't corrupt each other). Because the cache still
 * holds the row, the raw server `totalCount` would not drop on delete — so we
 * subtract the rows that are loaded but currently suppressed.
 *
 * `loadedCount - visibleCount` is exactly the number of suppressed rows present
 * in the loaded pages (visibleCount = loadedCount minus suppressed-in-view).
 * Clamped at 0 so a stale/lagging total can never render negative.
 */
export function visibleTotalCount(
  rawTotalCount: number | undefined,
  loadedCount: number,
  visibleCount: number,
): number | undefined {
  if (typeof rawTotalCount !== "number") return rawTotalCount;
  const suppressedInView = Math.max(0, loadedCount - visibleCount);
  return Math.max(0, rawTotalCount - suppressedInView);
}
