import { useLocale } from "next-intl";
import { uiLocaleToMarket, type Market } from "@/lib/shared/market";

export function useMarket(): Market {
  return uiLocaleToMarket(useLocale());
}
