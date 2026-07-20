const STATE_LOCATION_MAP = {
  NSW: ["NSW", "New South Wales", "Sydney", "Newcastle", "Wollongong"],
  VIC: ["VIC", "Victoria", "Melbourne", "Geelong"],
  QLD: ["QLD", "Queensland", "Brisbane", "Gold Coast", "Sunshine Coast"],
  WA: ["WA", "Western Australia", "Perth"],
  SA: ["SA", "South Australia", "Adelaide"],
  ACT: ["ACT", "Australian Capital Territory", "Canberra"],
  TAS: ["TAS", "Tasmania", "Hobart"],
  NT: ["NT", "Northern Territory", "Darwin"],
} as const;

type StateKey = keyof typeof STATE_LOCATION_MAP;

/**
 * Resolve one UI location filter into searchable aliases. Unknown state keys
 * fail open; they are never searched as a literal `state:XYZ` string.
 */
export function getJobLocationTerms(location?: string): string[] | null {
  if (!location) return null;
  if (!location.startsWith("state:")) return [location];

  const state = location.slice("state:".length) as StateKey;
  return state in STATE_LOCATION_MAP ? [...STATE_LOCATION_MAP[state]] : null;
}
