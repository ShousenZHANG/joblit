import { describe, expect, it } from "vitest";
import {
  isMarket,
  isResumeLocale,
  isUILocale,
  marketToResumeLocale,
  marketToUILocale,
  resumeLocaleToMarket,
  resumeLocaleToUILocale,
  uiLocaleToMarket,
  uiLocaleToResumeLocale,
} from "./market";

describe("market seam", () => {
  it("maps Market to ResumeLocale", () => {
    expect(marketToResumeLocale("AU")).toBe("en-AU");
    expect(marketToResumeLocale("CN")).toBe("zh-CN");
  });

  it("maps Market to UILocale", () => {
    expect(marketToUILocale("AU")).toBe("en");
    expect(marketToUILocale("CN")).toBe("zh");
  });

  it("maps ResumeLocale back to Market", () => {
    expect(resumeLocaleToMarket("en-AU")).toBe("AU");
    expect(resumeLocaleToMarket("zh-CN")).toBe("CN");
  });

  it("maps ResumeLocale to UILocale", () => {
    expect(resumeLocaleToUILocale("en-AU")).toBe("en");
    expect(resumeLocaleToUILocale("zh-CN")).toBe("zh");
  });

  it("maps UILocale string to Market", () => {
    expect(uiLocaleToMarket("en")).toBe("AU");
    expect(uiLocaleToMarket("zh")).toBe("CN");
    expect(uiLocaleToMarket("unknown")).toBe("AU"); // safe default
  });

  it("maps UILocale string to ResumeLocale", () => {
    expect(uiLocaleToResumeLocale("en")).toBe("en-AU");
    expect(uiLocaleToResumeLocale("zh")).toBe("zh-CN");
    expect(uiLocaleToResumeLocale("unknown")).toBe("en-AU");
  });

  it("guards reject invalid values", () => {
    expect(isMarket("AU")).toBe(true);
    expect(isMarket("US")).toBe(false);
    expect(isMarket(null)).toBe(false);

    expect(isResumeLocale("en-AU")).toBe(true);
    expect(isResumeLocale("en-US")).toBe(false);

    expect(isUILocale("en")).toBe(true);
    expect(isUILocale("ja")).toBe(false);
  });

  it("round-trips Market through ResumeLocale", () => {
    for (const m of ["AU", "CN"] as const) {
      expect(resumeLocaleToMarket(marketToResumeLocale(m))).toBe(m);
    }
  });
});
