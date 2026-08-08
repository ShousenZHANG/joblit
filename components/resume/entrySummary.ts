/**
 * The one-line summary under an entry's title ("Stripe · 2023 – now").
 *
 * Blank parts are dropped rather than rendered as stray separators, which is
 * what a resume half-filled with placeholder rows would otherwise produce.
 */
export function summaryLine(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
