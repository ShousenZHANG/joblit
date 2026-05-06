/**
 * Market / locale domain seam.
 *
 * Three related concepts that previously each had their own scattered
 * conditional across 6+ files:
 *
 *   Market       — geographic region (job source selection)
 *                  Values: "AU" | "CN"
 *
 *   ResumeLocale — BCP 47 locale tag stored on ResumeProfile rows and
 *                  used by the LaTeX renderer.
 *                  Values: "en-AU" | "zh-CN"
 *
 *   UILocale     — short locale code used by next-intl for translation
 *                  string lookup.
 *                  Values: "en" | "zh"
 *
 * All conversions live here. Adding a new market (e.g. "US") requires
 * only edits in this file and its tests, not 6 callsites.
 */

export type Market = "AU" | "CN";
export type ResumeLocale = "en-AU" | "zh-CN";
export type UILocale = "en" | "zh";

export const MARKETS: readonly Market[] = ["AU", "CN"] as const;
export const RESUME_LOCALES: readonly ResumeLocale[] = ["en-AU", "zh-CN"] as const;
export const UI_LOCALES: readonly UILocale[] = ["en", "zh"] as const;

export const DEFAULT_MARKET: Market = "AU";
export const DEFAULT_RESUME_LOCALE: ResumeLocale = "en-AU";
export const DEFAULT_UI_LOCALE: UILocale = "en";

/* ───────────────────────── conversions ───────────────────────── */

export function marketToResumeLocale(market: Market): ResumeLocale {
  return market === "CN" ? "zh-CN" : "en-AU";
}

/**
 * String-accepting variant for use with Prisma rows where `market` is
 * stored as a plain `String` column. Treats anything that isn't "CN"
 * as "AU" (matches DB default).
 */
export function marketStringToResumeLocale(market: string): ResumeLocale {
  return market === "CN" ? "zh-CN" : "en-AU";
}

export function marketToUILocale(market: Market): UILocale {
  return market === "CN" ? "zh" : "en";
}

export function resumeLocaleToMarket(locale: ResumeLocale): Market {
  return locale === "zh-CN" ? "CN" : "AU";
}

export function resumeLocaleToUILocale(locale: ResumeLocale): UILocale {
  return locale === "zh-CN" ? "zh" : "en";
}

export function uiLocaleToMarket(locale: string): Market {
  return locale === "zh" ? "CN" : "AU";
}

export function uiLocaleToResumeLocale(locale: string): ResumeLocale {
  return locale === "zh" ? "zh-CN" : "en-AU";
}

/* ───────────────────────── guards ───────────────────────── */

export function isMarket(value: unknown): value is Market {
  return value === "AU" || value === "CN";
}

export function isResumeLocale(value: unknown): value is ResumeLocale {
  return value === "en-AU" || value === "zh-CN";
}

export function isUILocale(value: unknown): value is UILocale {
  return value === "en" || value === "zh";
}
