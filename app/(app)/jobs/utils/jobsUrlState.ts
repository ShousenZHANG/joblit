import type { JobStatus } from "../types";
import { isJobStatus } from "@/lib/shared/jobStatus";

export type JobsUrlState = {
  q: string;
  statusFilter: JobStatus;
  locationFilter: string;
  jobLevelFilter: string;
  selectedId: string | null;
  view: "list" | "detail";
};

const URL_KEYS = {
  q: "q",
  statusFilter: "status",
  locationFilter: "location",
  jobLevelFilter: "level",
  selectedId: "job",
  view: "view",
} as const satisfies Record<keyof JobsUrlState, string>;

const DEFAULTS: JobsUrlState = {
  q: "",
  statusFilter: "NEW",
  locationFilter: "ALL",
  jobLevelFilter: "ALL",
  selectedId: null,
  view: "list",
};

export function parseJobsUrlState(params: URLSearchParams): JobsUrlState {
  const status = params.get(URL_KEYS.statusFilter);
  const view = params.get(URL_KEYS.view);

  return {
    q: params.get(URL_KEYS.q) ?? DEFAULTS.q,
    statusFilter: isJobStatus(status) ? status : DEFAULTS.statusFilter,
    locationFilter: params.get(URL_KEYS.locationFilter) || DEFAULTS.locationFilter,
    jobLevelFilter: params.get(URL_KEYS.jobLevelFilter) || DEFAULTS.jobLevelFilter,
    selectedId: params.get(URL_KEYS.selectedId),
    view: view === "detail" ? "detail" : DEFAULTS.view,
  };
}

export function writeJobsUrlState(
  params: URLSearchParams,
  patch: Partial<JobsUrlState>,
): URLSearchParams {
  const next = new URLSearchParams(params);

  for (const key of Object.keys(patch) as Array<keyof JobsUrlState>) {
    const value = patch[key];
    const urlKey = URL_KEYS[key];

    if (value === undefined) continue;
    if (value === null || value === DEFAULTS[key]) {
      next.delete(urlKey);
    } else {
      next.set(urlKey, value);
    }
  }

  return next;
}
