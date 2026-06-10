/**
 * Locale-aware relative time ("3h ago" / "3小时前"). Uses the platform
 * Intl.RelativeTimeFormat so time units are never hand-translated. `locale`
 * defaults to English; callers pass the active UI locale.
 */
export function relativeTime(iso: string, locale: string = "en"): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const hours = Math.floor((Date.now() - ms) / (1000 * 60 * 60));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (hours < 1) return rtf.format(0, "second");
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

/** Format large numbers: 1000 → "1k", 1200 → "1.2k", 500 → "500" */
export function formatCount(n: number): string {
  if (n >= 1_000) {
    const val = n / 1000;
    return `${Number.isInteger(val) ? val : val.toFixed(1)}k`;
  }
  return String(n);
}

/** Video duration badge: 754 → "12:34", 4505 → "1:15:05". Empty for 0/invalid. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
