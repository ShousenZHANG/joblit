import { useLocale } from "next-intl";

export function useMarket(): "AU" | "CN" {
  const locale = useLocale();
  return locale === "zh" ? "CN" : "AU";
}
