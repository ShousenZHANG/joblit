/**
 * When a FetchRun counts as abandoned.
 *
 * A run is driven by the AU GitHub Actions worker. A cancelled workflow can
 * disappear without writing a terminal status, so a run that has not reported
 * in this long is treated as dead rather than merely slow.
 *
 * These lived in `fetchRunQuota.ts`, which is gone: the quota it enforced was
 * removed. The staleness rule is not a quota and outlives it.
 */
export const FETCH_RUN_STALE_AFTER_MS = 30 * 60 * 1000;

export const FETCH_RUN_STALE_ERROR =
  "Dispatch timeout: worker did not report status within 30 minutes";

export function fetchRunStaleCutoff(now = new Date()) {
  return new Date(now.getTime() - FETCH_RUN_STALE_AFTER_MS);
}
