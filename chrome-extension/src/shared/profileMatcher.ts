/**
 * Profile matcher — detects if a user-typed value matches a profile field.
 * Used to auto-link corrections to profilePath instead of staticValue.
 */

import type { FlatProfile } from "../content/filler/formFiller";

export interface ProfileMatch {
  profilePath: string;
  confidence: number;
}

/**
 * Find if a user-typed value matches any field in the flat profile.
 * Returns the best matching profilePath or null.
 */
export function matchValueToProfile(
  value: string,
  profile: FlatProfile,
): ProfileMatch | null {
  if (!value.trim()) return null;

  const normalizedValue = value.trim().toLowerCase();

  // Exact match — highest confidence
  for (const [key, profileValue] of Object.entries(profile)) {
    if (!profileValue) continue;
    if (profileValue.trim().toLowerCase() === normalizedValue) {
      return { profilePath: key, confidence: 1.0 };
    }
  }

  // Substring match for longer values (e.g. user types part of address)
  if (normalizedValue.length >= 5) {
    for (const [key, profileValue] of Object.entries(profile)) {
      if (!profileValue) continue;
      const normalizedProfile = profileValue.trim().toLowerCase();
      if (
        normalizedProfile.includes(normalizedValue) ||
        normalizedValue.includes(normalizedProfile)
      ) {
        return { profilePath: key, confidence: 0.7 };
      }
    }
  }

  return null;
}
