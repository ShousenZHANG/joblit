import type { Market } from "@/lib/shared/market";

/** Keep locale-backed workspaces isolated to their own persisted market. */
export function getVisibleJobMarkets(market: Market): Market[] {
  return [market];
}
