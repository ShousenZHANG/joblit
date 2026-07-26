export const FETCH_RUN_COMMIT_PROTOCOL = "fetch-run-commit/v1" as const;

// Inline discovery is bounded by the trigger route's 60-second serverless
// budget. The extra 30 seconds prevents a retry from overlapping a viable
// invocation while still recovering promptly after a hard process loss.
export const INLINE_FETCH_RUN_EXECUTION_LEASE_MS = 90_000;

// AU runs execute in GitHub Actions and can legitimately outlive one web
// request. A different worker may take over only after the same interval used
// by stale-run recovery. The current attempt remains allowed to finish after
// expiry unless another start command actually claims the run.
export const AU_FETCH_RUN_EXECUTION_LEASE_MS = 30 * 60 * 1000;
