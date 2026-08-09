import { describe, expect, it } from "vitest";
import { getVisibleJobMarkets } from "./jobMarketScope";

describe("getVisibleJobMarkets", () => {
  it("keeps the Australian workspace AU-only", () => {
    expect(getVisibleJobMarkets("AU")).toEqual(["AU"]);
  });

  it("keeps the Chinese workspace CN-only", () => {
    expect(getVisibleJobMarkets("CN")).toEqual(["CN"]);
  });
});
