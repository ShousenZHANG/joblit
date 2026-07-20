import type { Market } from "@/lib/shared/market";

/**
 * Markets stored on Job rows are wider than the locale-backed workspace
 * markets. GLOBAL rows belong in the English/Australian workspace, but GLOBAL
 * must not become a UI locale.
 */
export type PersistedJobMarket = Market | "GLOBAL";

export function getVisibleJobMarkets(market: Market): PersistedJobMarket[] {
  return market === "AU" ? ["AU", "GLOBAL"] : ["CN"];
}
