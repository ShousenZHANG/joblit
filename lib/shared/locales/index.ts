import { enAU } from "./en-AU";
import { zhCN } from "./zh-CN";

export type LocaleProfile = {
  locale: "en-AU" | "zh-CN";
  label: string;
  /** Word count range for en-AU; character count range for zh-CN */
  coverWordRange: { min: number; max: number };
  dateFormat: string;
  dateExample: string;
  salutationStyle: string;
  toneRules: string[];
};

const PROFILES: Record<string, LocaleProfile> = {
  "en-AU": enAU,
  "zh-CN": zhCN,
};

export function getLocaleProfile(locale: "en-AU" | "zh-CN"): LocaleProfile {
  return PROFILES[locale] ?? enAU;
}
