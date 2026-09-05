import { describe, expect, it } from "vitest";

import { splitTitleQualifier } from "./splitTitleQualifier";

describe("splitTitleQualifier", () => {
  it("splits a long trailing parenthetical off the role name, parentheses kept", () => {
    expect(
      splitTitleQualifier(
        "Application Developer - PowerApps (Fixed term Full Time Opportunity until 30 June 2027)",
      ),
    ).toEqual({
      main: "Application Developer - PowerApps",
      qualifier: "(Fixed term Full Time Opportunity until 30 June 2027)",
    });
  });

  it("leaves a short parenthetical in the role name", () => {
    // These read as part of what the job is called, not as posting metadata.
    for (const title of [
      "Software Engineer (Contract)",
      "Backend Engineer (m/f/d)",
      "Data Analyst (AU)",
    ]) {
      expect(splitTitleQualifier(title)).toEqual({ main: title, qualifier: null });
    }
  });

  it("does not split a nested or unbalanced parenthetical", () => {
    const nested = "Engineer (Platform (Payments) Team, 12 months)";
    expect(splitTitleQualifier(nested)).toEqual({ main: nested, qualifier: null });

    const unbalanced = "Engineer (12 month fixed term contract";
    expect(splitTitleQualifier(unbalanced)).toEqual({
      main: unbalanced,
      qualifier: null,
    });
  });

  it("returns the whole title when there is no parenthetical", () => {
    expect(splitTitleQualifier("Senior Machine Learning Engineer")).toEqual({
      main: "Senior Machine Learning Engineer",
      qualifier: null,
    });
  });

  it("never loses or invents a character", () => {
    // The heading renders main and qualifier as one accessible name, so the
    // two halves rejoined must be the posted title.
    const title =
      "Product Designer (Parental leave cover, 9 month fixed term)   ";
    const { main, qualifier } = splitTitleQualifier(title);
    expect(`${main} ${qualifier}`).toBe(title.trim());
  });

  it("survives an empty or whitespace title without throwing", () => {
    expect(splitTitleQualifier("")).toEqual({ main: "", qualifier: null });
    expect(splitTitleQualifier("   ")).toEqual({ main: "", qualifier: null });
  });

  it("does not strip a title that is nothing but a parenthetical", () => {
    // There would be no role left to render in the heading.
    const only = "(Fixed term until 30 June 2027)";
    expect(splitTitleQualifier(only)).toEqual({ main: only, qualifier: null });
  });
});
