/** Relative time display: "just now", "3h ago", "5d ago" */
export function relativeTime(iso: string): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const hours = Math.floor((Date.now() - ms) / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Format large numbers: 1000 → "1k", 1200 → "1.2k", 500 → "500" */
export function formatCount(n: number): string {
  if (n >= 1_000) {
    const val = n / 1000;
    return `${Number.isInteger(val) ? val : val.toFixed(1)}k`;
  }
  return String(n);
}
