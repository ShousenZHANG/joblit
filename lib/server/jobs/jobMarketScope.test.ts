import { describe, expect, it } from "vitest";
import { getVisibleJobMarkets } from "./jobMarketScope";

describe("getVisibleJobMarkets", () => {
  it("includes GLOBAL sources in the English/Australian workspace", () => {
    expect(getVisibleJobMarkets("AU")).toEqual(["AU", "GLOBAL"]);
  });

  it("keeps the Chinese workspace isolated from GLOBAL sources", () => {
    expect(getVisibleJobMarkets("CN")).toEqual(["CN"]);
  });
});
