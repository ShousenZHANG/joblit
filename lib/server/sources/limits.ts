/**
 * Keep one user-triggered GLOBAL fetch inside the 60-second serverless budget.
 *
 * Source requests run eight-at-a-time with a 12-second per-request timeout.
 * Twenty-four sources therefore consume at most three network waves (36s),
 * leaving budget for guarded ATS recovery, filtering, persistence and cleanup.
 */
export const MAX_GLOBAL_SOURCES_PER_RUN = 24;
