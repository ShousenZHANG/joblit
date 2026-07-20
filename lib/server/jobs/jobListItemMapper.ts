export function normalizePostingRiskFlags(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((flag): flag is string => typeof flag === "string");
}
