export const FETCH_RUN_COMMIT_PROTOCOL = "fetch-run-commit/v1" as const;

// AU runs execute in GitHub Actions and can legitimately outlive one web
// request. A different worker may take over only after the same interval used
// by stale-run recovery. The current attempt remains allowed to finish after
// expiry unless another start command actually claims the run.
export const AU_FETCH_RUN_EXECUTION_LEASE_MS = 30 * 60 * 1000;
