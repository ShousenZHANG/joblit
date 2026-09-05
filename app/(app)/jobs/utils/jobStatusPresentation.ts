import { toActiveJobStatus, type ActiveJobStatusValue } from "@/lib/shared/jobStatus";

/**
 * How a stored `Job.status` is shown, anywhere it is shown.
 *
 * Callers pass any of the seven values the database can hold and get back one
 * of three reachable presentations — the ADR-0007 projection is applied here
 * rather than at each call site, so a row the migration missed can never render
 * a badge no filter can select.
 *
 * This exists because the label map and two badge maps were maintained
 * separately and had already diverged: `APPLIED` was sky blue in a list row and
 * a different colour in the detail header, and `REJECTED` was rose in one and
 * neutral grey in the other. The same Job rendered differently depending on
 * which pane you looked at.
 */
export type JobStatusPresentation = {
  status: ActiveJobStatusValue;
  /** Key into the `jobs` message namespace. */
  labelKey: "statusNew" | "statusApplied" | "statusRejected";
  /** Badge classes for a list row — bordered, tuned for dense rows. */
  badgeClass: string;
  /** Badge classes for the detail header — ringed, tuned for a larger surface. */
  headerClass: string;
  /**
   * The detail header states the status as a coloured dot beside the word,
   * not as a filled badge: the header's job is to name the role, and a second
   * tinted block there competed with the one action the panel exists for.
   * A dot needs a solid fill rather than the bg/text/ring triple above, so it
   * carries its own class — bound to the same hue by the presentation test.
   */
  dotClass: string;
};

const PRESENTATIONS: Record<ActiveJobStatusValue, JobStatusPresentation> = {
  // NEW      — emerald (fresh opportunity, aligns with brand accent)
  // APPLIED  — sky blue (action taken, in-progress)
  // REJECTED — rose (terminal, visually distinct from neutral grey)
  NEW: {
    status: "NEW",
    labelKey: "statusNew",
    badgeClass:
      "border border-emerald-300/60 bg-emerald-100 text-emerald-800 " +
      "dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-300",
    headerClass:
      "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 " +
      "dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
    dotClass: "bg-emerald-500 dark:bg-emerald-400",
  },
  APPLIED: {
    status: "APPLIED",
    labelKey: "statusApplied",
    badgeClass:
      "border border-sky-300/60 bg-sky-100 text-sky-800 " +
      "dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-300",
    headerClass:
      "bg-sky-100 text-sky-800 ring-1 ring-sky-200 " +
      "dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30",
    dotClass: "bg-sky-500 dark:bg-sky-400",
  },
  REJECTED: {
    status: "REJECTED",
    labelKey: "statusRejected",
    badgeClass:
      "border border-rose-300/60 bg-rose-100 text-rose-800 " +
      "dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-300",
    headerClass:
      "bg-rose-100 text-rose-800 ring-1 ring-rose-200 " +
      "dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30",
    dotClass: "bg-rose-500 dark:bg-rose-400",
  },
};

export function jobStatusPresentation(stored: string): JobStatusPresentation {
  return PRESENTATIONS[toActiveJobStatus(stored)];
}
