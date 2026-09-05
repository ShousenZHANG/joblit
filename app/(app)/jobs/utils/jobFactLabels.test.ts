import { describe, expect, it } from "vitest";

import { jobTypeLabelKey, sentenceCase } from "./jobFactLabels";

describe("jobTypeLabelKey", () => {
  it("normalises the shapes the feeds actually ship", () => {
    for (const raw of ["fulltime", "Full-time", "FULL_TIME", " Full Time "]) {
      expect(jobTypeLabelKey(raw)).toBe("jobTypeFulltime");
    }
    expect(jobTypeLabelKey("part-time")).toBe("jobTypeParttime");
    expect(jobTypeLabelKey("Contract")).toBe("jobTypeContract");
    expect(jobTypeLabelKey("internship")).toBe("jobTypeInternship");
    expect(jobTypeLabelKey("Temporary")).toBe("jobTypeTemporary");
  });

  it("returns null for a value it does not recognise", () => {
    // The caller shows the raw value sentence-cased rather than hiding a fact
    // the posting stated.
    expect(jobTypeLabelKey("per_diem")).toBeNull();
    expect(jobTypeLabelKey("")).toBeNull();
    expect(jobTypeLabelKey(null)).toBeNull();
    expect(jobTypeLabelKey(undefined)).toBeNull();
  });
});

describe("sentenceCase", () => {
  it("capitalises the first letter and leaves the rest alone", () => {
    expect(sentenceCase("mid-senior level")).toBe("Mid-senior level");
    expect(sentenceCase("on site")).toBe("On site");
  });

  it("does not lowercase an acronym or a word the posting capitalised", () => {
    expect(sentenceCase("NSW hybrid")).toBe("NSW hybrid");
  });

  it("trims and survives empty input", () => {
    expect(sentenceCase("  remote  ")).toBe("Remote");
    expect(sentenceCase("")).toBe("");
  });
});
