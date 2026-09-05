/**
 * Turn a feed's raw fact tokens into text a person reads.
 *
 * `Job.jobType` arrives however the source wrote it — `fulltime`, `Full-time`,
 * `FULL_TIME` — and the detail header used to print it verbatim, so the
 * product shipped the string `fulltime` to the user. The vocabulary is small
 * and stable enough to translate, which also gets the zh-CN reader a Chinese
 * word instead of an English one.
 *
 * Anything outside the map returns null rather than a guess: the caller shows
 * the raw value sentence-cased, because a fact the posting stated is worth
 * more than a tidy blank.
 */

/**
 * Values are message keys under the `jobs` namespace, typed as literals so
 * next-intl accepts them and so `test/messagesContract.test.ts` can see every
 * key this module can produce. Same pattern as `JOB_STATUS_LABEL_KEYS`.
 */
const JOB_TYPE_LABEL_KEYS = {
  fulltime: "jobTypeFulltime",
  parttime: "jobTypeParttime",
  contract: "jobTypeContract",
  internship: "jobTypeInternship",
  temporary: "jobTypeTemporary",
} as const;

export type JobTypeLabelKey =
  (typeof JOB_TYPE_LABEL_KEYS)[keyof typeof JOB_TYPE_LABEL_KEYS];

export function jobTypeLabelKey(
  raw: string | null | undefined,
): JobTypeLabelKey | null {
  if (!raw) return null;
  // Sources differ only in separators and case, so collapse both rather than
  // enumerating every spelling.
  const normalized = raw.toLowerCase().replace(/[\s_-]/g, "");
  return (
    JOB_TYPE_LABEL_KEYS[normalized as keyof typeof JOB_TYPE_LABEL_KEYS] ?? null
  );
}

/**
 * Capitalise the first letter and change nothing else.
 *
 * Title-casing would damage the values this is used on: "NSW hybrid" becomes
 * "Nsw Hybrid", and "mid-senior level" becomes "Mid-Senior Level", neither of
 * which the posting said.
 */
export function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
