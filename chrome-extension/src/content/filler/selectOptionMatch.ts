/**
 * Robust option matching for <select> / custom dropdowns.
 *
 * The previous chain (exact value → exact text → substring) missed the most
 * common real-world failure: country / state dropdowns where the profile holds
 * a full name ("Australia", "New South Wales") but the option uses a code
 * ("AU", "NSW") or vice-versa. It also let bare substring matches misfire — a
 * 2-char profile value like "us" substring-matches "Australia", "Austria",
 * "Belarus". This module normalizes both sides, resolves country/state
 * aliases, and only falls back to substring matching under length guards.
 */

/** Lowercase, strip diacritics + punctuation, collapse whitespace. */
export function normalizeOption(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ") // keep alnum + CJK
    .trim()
    .replace(/\s+/g, " ");
}

// Alias groups — every member normalized. A value matches an option when their
// alias groups intersect. Focused on the markets Joblit targets (AU primary,
// US, common English-speaking + a few majors) plus AU/US state codes.
const ALIAS_GROUPS: string[][] = [
  // Countries
  ["australia", "au", "aus"],
  ["united states", "us", "usa", "united states of america", "u s a"],
  ["united kingdom", "uk", "gb", "great britain", "britain", "england"],
  ["china", "cn", "prc", "peoples republic of china", "中国"],
  ["new zealand", "nz"],
  ["canada", "ca", "can"],
  ["india", "in", "ind"],
  ["singapore", "sg", "sgp"],
  ["germany", "de", "deu"],
  ["france", "fr", "fra"],
  ["ireland", "ie", "irl"],
  ["japan", "jp", "jpn"],
  ["hong kong", "hk", "hkg", "香港"],
  // AU states / territories
  ["new south wales", "nsw"],
  ["victoria", "vic"],
  ["queensland", "qld"],
  ["western australia", "wa"],
  ["south australia", "sa"],
  ["tasmania", "tas"],
  ["northern territory", "nt"],
  ["australian capital territory", "act"],
  // A few high-frequency US states
  ["california", "ca", "calif"],
  ["new york", "ny"],
  ["texas", "tx"],
  ["washington", "wa"],
  ["massachusetts", "ma"],
];

const ALIAS_INDEX: Map<string, Set<string>> = (() => {
  const index = new Map<string, Set<string>>();
  for (const group of ALIAS_GROUPS) {
    const set = new Set(group.map(normalizeOption));
    for (const member of set) {
      // Merge so a member appearing in multiple groups (e.g. "wa", "ca") maps
      // to the union — within a single country-scoped select that's harmless
      // and maximizes recall.
      const existing = index.get(member);
      if (existing) {
        for (const m of set) existing.add(m);
      } else {
        index.set(member, new Set(set));
      }
    }
  }
  return index;
})();

/** All normalized aliases for a value (itself + any alias-group members). */
export function aliasesFor(value: string): Set<string> {
  const norm = normalizeOption(value);
  const group = ALIAS_INDEX.get(norm);
  if (group) return new Set(group);
  return new Set([norm]);
}

export interface OptionLike {
  value: string;
  text: string;
}

/**
 * Pick the best-matching option index for a profile value, or -1.
 * Priority: exact raw value → exact normalized text/value → alias intersection
 * → startsWith (≥3 chars) → guarded substring (≥4 chars). Earlier, more
 * precise tiers always win.
 */
export function findBestOptionIndex(options: OptionLike[], value: string): number {
  if (options.length === 0) return -1;
  const rawValue = value.trim();
  const norm = normalizeOption(value);
  if (!norm) return -1;

  const normOptions = options.map((o) => ({
    nText: normalizeOption(o.text),
    nValue: normalizeOption(o.value),
  }));

  // 1. Exact raw value (case-sensitive — many ATS use exact codes).
  const exactRaw = options.findIndex((o) => o.value === rawValue);
  if (exactRaw !== -1) return exactRaw;

  // 2. Exact normalized text or value.
  const exactNorm = normOptions.findIndex(
    (o) => o.nText === norm || o.nValue === norm,
  );
  if (exactNorm !== -1) return exactNorm;

  // 3. Alias intersection (country/state code ↔ full name).
  const valueAliases = aliasesFor(value);
  if (valueAliases.size > 1 || ALIAS_INDEX.has(norm)) {
    const aliasHit = normOptions.findIndex((o) => {
      if (valueAliases.has(o.nText) || valueAliases.has(o.nValue)) return true;
      // Also expand the option side (option may itself be the code form).
      const optAliases = aliasesFor(o.nText);
      const optValAliases = aliasesFor(o.nValue);
      for (const a of valueAliases) {
        if (optAliases.has(a) || optValAliases.has(a)) return true;
      }
      return false;
    });
    if (aliasHit !== -1) return aliasHit;
  }

  // 4. startsWith — guard against 1-2 char noise.
  if (norm.length >= 3) {
    const starts = normOptions.findIndex(
      (o) => o.nText.startsWith(norm) || norm.startsWith(o.nText) && o.nText.length >= 3,
    );
    if (starts !== -1) return starts;
  }

  // 5. Guarded substring — only for reasonably specific values.
  if (norm.length >= 4) {
    const sub = normOptions.findIndex((o) => o.nText.includes(norm));
    if (sub !== -1) return sub;
  }

  return -1;
}
