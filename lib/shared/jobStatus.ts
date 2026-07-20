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

const JOB_STATUS_SET = new Set<string>(JOB_STATUS_VALUES);

export const JOB_STATUS_TRANSITIONS: Record<
  JobStatusValue,
  readonly JobStatusValue[]
> = {
  // Recruiter-led processes can legitimately start at interview or offer
  // without an application event recorded in Joblit.
  NEW: ["APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  APPLIED: ["NEW", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["APPLIED", "OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["INTERVIEW", "ACCEPTED", "REJECTED", "WITHDRAWN"],
  REJECTED: ["NEW", "APPLIED"],
  WITHDRAWN: ["NEW", "APPLIED"],
  ACCEPTED: ["OFFER", "WITHDRAWN"],
};

export function isJobStatus(value: unknown): value is JobStatusValue {
  return typeof value === "string" && JOB_STATUS_SET.has(value);
}

export function canTransitionJobStatus(
  from: JobStatusValue,
  to: JobStatusValue,
): boolean {
  return from !== to && JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function selectableJobStatuses(
  current: JobStatusValue,
): readonly JobStatusValue[] {
  return [current, ...JOB_STATUS_TRANSITIONS[current]];
}
