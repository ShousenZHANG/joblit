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
    const applyLocale = (stored: unknown) => {
      const resolved: Locale = typeof stored === "string"
        ? stored.startsWith("zh") ? "zh" : "en"
        : detectLocale();
      setLocale(resolved);
      setCurrentLocale(resolved);
      setReady(true);
    };

    chrome.storage.local.get(STORAGE_KEYS.LOCALE, (result) => {
      applyLocale(result[STORAGE_KEYS.LOCALE]);
    });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.LOCALE]) return;
      applyLocale(changes[STORAGE_KEYS.LOCALE].newValue);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  return { t, locale, ready };
}
