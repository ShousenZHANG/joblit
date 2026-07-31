import { z } from "zod";

/**
 * Fit scan progress, as the Jobs page reads it.
 *
 * Scoring runs in the Runner, so these counts are the browser's only view of
 * what has happened. Parsing them at the boundary means a shape change shows
 * up as a validation failure rather than as `NaN` in a progress banner.
 */

const count = z.number().int().min(0);

export const fitRunStatsSchema = z.object({
  /** All NEW jobs for the user. */
  total: count,
  /** NEW jobs with a score or a terminal failed mark. */
  scored: count,
  /** NEW jobs still waiting to be scored. */
  pending: count,
});

export const fitRunStartSchema = fitRunStatsSchema.extend({
  /** Cleared deterministically by this run's prescreen. */
  prescreened: count,
});
