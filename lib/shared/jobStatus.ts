/**
 * Every status the database can hold, including the four retired by ADR-0007.
 * Parsing must still accept them: the ApplicationEvent ledger records historic
 * transitions verbatim and must stay readable forever.
 */
export const JOB_STATUS_VALUES = [
  "NEW",
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "ACCEPTED",
] as const;

export type JobStatusValue = (typeof JOB_STATUS_VALUES)[number];

/**
 * The statuses Joblit actually offers. Interview, offer, acceptance and
 * withdrawal are pipeline-management concerns — the same surface ADR-0006
 * retired with the Career workspace — so the triage board tracks the three
 * states its own workflow produces: untouched, applied, ruled out.
 */
export const ACTIVE_JOB_STATUS_VALUES = [
  "NEW",
  "APPLIED",
  "REJECTED",
] as const satisfies readonly JobStatusValue[];

export type ActiveJobStatusValue = (typeof ACTIVE_JOB_STATUS_VALUES)[number];

const JOB_STATUS_SET = new Set<string>(JOB_STATUS_VALUES);
const ACTIVE_JOB_STATUS_SET = new Set<string>(ACTIVE_JOB_STATUS_VALUES);

/**
 * Where a retired status lands when it is read back. Progressing states all
 * mean "this application is live", and withdrawal means "not pursuing", so
 * each collapses onto the active state carrying the same meaning.
 */
const RETIRED_STATUS_PROJECTION: Record<string, ActiveJobStatusValue> = {
  INTERVIEW: "APPLIED",
  OFFER: "APPLIED",
  ACCEPTED: "APPLIED",
  WITHDRAWN: "REJECTED",
};

export const JOB_STATUS_TRANSITIONS: Record<
  ActiveJobStatusValue,
  readonly ActiveJobStatusValue[]
> = {
  NEW: ["APPLIED", "REJECTED"],
  APPLIED: ["NEW", "REJECTED"],
  REJECTED: ["NEW", "APPLIED"],
};

export function isJobStatus(value: unknown): value is JobStatusValue {
  return typeof value === "string" && JOB_STATUS_SET.has(value);
}

export function isActiveJobStatus(
  value: unknown,
): value is ActiveJobStatusValue {
  return typeof value === "string" && ACTIVE_JOB_STATUS_SET.has(value);
}

/**
 * Read any stored status as one of the three active states. Rows written
 * before the collapse — and any that slip past a failed migration — stay
 * reachable rather than disappearing from a board that can no longer filter
 * for them.
 */
export function toActiveJobStatus(value: JobStatusValue): ActiveJobStatusValue {
  return isActiveJobStatus(value)
    ? value
    : (RETIRED_STATUS_PROJECTION[value] ?? "NEW");
}

export function canTransitionJobStatus(
  from: JobStatusValue,
  to: JobStatusValue,
): boolean {
  if (!isActiveJobStatus(to)) return false;
  const source = toActiveJobStatus(from);
  return source !== to && JOB_STATUS_TRANSITIONS[source].includes(to);
}

export function selectableJobStatuses(
  current: JobStatusValue,
): readonly ActiveJobStatusValue[] {
  const source = toActiveJobStatus(current);
  return [source, ...JOB_STATUS_TRANSITIONS[source]];
}
