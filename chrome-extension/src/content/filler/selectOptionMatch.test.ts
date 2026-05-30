import { describe, it, expect } from "vitest";
import { normalizeOption, aliasesFor, findBestOptionIndex } from "./selectOptionMatch";

const opts = (...pairs: Array<[string, string]>) =>
  pairs.map(([value, text]) => ({ value, text }));

describe("normalizeOption", () => {
  it("lowercases, strips punctuation/diacritics, collapses space", () => {
    expect(normalizeOption("  U.S.A.  ")).toBe("u s a");
    expect(normalizeOption("Côte d'Ivoire")).toBe("cote d ivoire");
    expect(normalizeOption("New   York")).toBe("new york");
  });
});

describe("aliasesFor", () => {
  it("expands a country to its code aliases", () => {
    const a = aliasesFor("Australia");
    expect(a.has("au")).toBe(true);
    expect(a.has("australia")).toBe(true);
  });
  it("expands a code to the full name", () => {
    expect(aliasesFor("NSW").has("new south wales")).toBe(true);
  });
});

describe("findBestOptionIndex", () => {
  it("exact raw value wins", () => {
    expect(findBestOptionIndex(opts(["AU", "Australia"], ["US", "United States"]), "US")).toBe(1);
  });

  it("matches full profile name to a code option (country)", () => {
    const o = opts(["AU", "AU"], ["US", "US"], ["NZ", "NZ"]);
    expect(findBestOptionIndex(o, "Australia")).toBe(0);
    expect(findBestOptionIndex(o, "United States")).toBe(1);
  });

  it("matches a code profile value to a full-name option", () => {
    const o = opts(["1", "Australia"], ["2", "New Zealand"]);
    expect(findBestOptionIndex(o, "AU")).toBe(0);
  });

  it("matches AU state name to abbreviation option", () => {
    const o = opts(["NSW", "NSW"], ["VIC", "VIC"], ["QLD", "QLD"]);
    expect(findBestOptionIndex(o, "New South Wales")).toBe(0);
    expect(findBestOptionIndex(o, "Victoria")).toBe(1);
  });

  it("does NOT substring-misfire a 2-char value", () => {
    // "us" must not match "Australia"/"Austria" via substring.
    const o = opts(["1", "Australia"], ["2", "Austria"]);
    expect(findBestOptionIndex(o, "zz")).toBe(-1);
  });

  it("exact normalized text beats nothing", () => {
    const o = opts(["x", "Full-Time"], ["y", "Part-Time"]);
    expect(findBestOptionIndex(o, "full time")).toBe(0);
  });

  it("guarded substring for specific values", () => {
    const o = opts(["1", "Bachelor of Science"], ["2", "Master of Science"]);
    expect(findBestOptionIndex(o, "Master")).toBe(1);
  });

  it("returns -1 when nothing matches", () => {
    expect(findBestOptionIndex(opts(["1", "Red"], ["2", "Blue"]), "Green")).toBe(-1);
  });

  it("returns -1 on empty options", () => {
    expect(findBestOptionIndex([], "Australia")).toBe(-1);
  });
});
