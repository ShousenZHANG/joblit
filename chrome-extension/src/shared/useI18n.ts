import { useState, useEffect } from "react";
import { detectLocale, setLocale, t, type Locale } from "./i18n";
import { STORAGE_KEYS } from "./constants";

/**
 * React hook that initializes i18n from stored locale preference
 * and returns the translation function.
 */
export function useI18n(): { t: typeof t; locale: Locale; ready: boolean } {
  const [locale, setCurrentLocale] = useState<Locale>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.LOCALE, (result) => {
      const stored = result[STORAGE_KEYS.LOCALE];
      // Map "en-AU" → "en", "zh-CN" → "zh"
      const resolved: Locale = stored?.startsWith("zh") ? "zh" : stored ? "en" : detectLocale();
      setLocale(resolved);
      setCurrentLocale(resolved);
      setReady(true);
    });
  }, []);

  return { t, locale, ready };
}
