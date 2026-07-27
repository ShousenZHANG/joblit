import { describe, expect, it } from "vitest";
import corpus from "@/test/fetchRelevance.corpus.json";
import {
  isListingDateAcceptable,
  isTitleRelevant,
  isUnusableDescription,
  isUnusableTitle,
  isUsableJobUrl,
  matchesBaseQueryConstraints,
} from "./jobRelevance";

type Case = {
  name: string;
  baseQueries: string[];
  queries: string[];
  titles: Record<string, boolean>;
};

// The JSON import is inferred as a union of per-case literal shapes, so the
// widening step is unavoidable here.
const cases = corpus.cases as unknown as Case[];

/**
 * The corpus is the contract between this matcher and the AU worker's. Both
 * suites read the same file, so a rule that moves on one side without the
 * other fails here or in test_run_jobspy.py rather than silently changing how
 * many roles a user sees.
 */
describe("jobRelevance — shared conformance corpus", () => {
  it("ships a corpus with cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    describe(testCase.name, () => {
      for (const [title, expected] of Object.entries(testCase.titles)) {
        it(`${expected ? "keeps" : "drops"} ${title}`, () => {
          const relevant =
            isTitleRelevant(title, testCase.queries) &&
            matchesBaseQueryConstraints(title, testCase.baseQueries);
          expect(relevant).toBe(expected);
        });
      }
    });
  }
});

describe("jobRelevance — unusable rows", () => {
  it.each(corpus.unusableTitles)("rejects the scraped index title %j", (title) => {
    expect(isUnusableTitle(title)).toBe(true);
  });

  it.each(corpus.usableTitles)("accepts the real title %j", (title) => {
    expect(isUnusableTitle(title)).toBe(false);
  });

  it.each(corpus.unusableDescriptions)("rejects the wall text %j", (description) => {
    expect(isUnusableDescription(description)).toBe(true);
  });

  it.each(corpus.usableDescriptions)("accepts the description %j", (description) => {
    expect(isUnusableDescription(description)).toBe(false);
  });

  it("rejects a non-http job url", () => {
    expect(isUsableJobUrl("javascript:alert(1)")).toBe(false);
    expect(isUsableJobUrl("mailto:jobs@example.com")).toBe(false);
    expect(isUsableJobUrl("not a url")).toBe(false);
    expect(isUsableJobUrl("")).toBe(false);
    expect(isUsableJobUrl(null)).toBe(false);
  });

  it("accepts an absolute http(s) job url", () => {
    expect(isUsableJobUrl("https://example.com/jobs/1")).toBe(true);
    expect(isUsableJobUrl("http://example.com/jobs/1")).toBe(true);
  });
});

describe("jobRelevance — listing date", () => {
  const now = new Date("2026-07-26T00:00:00.000Z");
  const hoursFromNow = (hours: number) =>
    new Date(now.getTime() + hours * 3_600_000).toISOString();

  it("accepts a listing inside the window", () => {
    expect(isListingDateAcceptable(hoursFromNow(-10), 72, now)).toBe(true);
  });

  it("allows a grace window on the old side for day-precision feeds", () => {
    expect(isListingDateAcceptable(hoursFromNow(-80), 72, now)).toBe(true);
  });

  it("rejects a listing well past the window", () => {
    expect(isListingDateAcceptable(hoursFromNow(-200), 72, now)).toBe(false);
  });

  it("rejects a listing dated in the future — that is a parse error, not a fresh role", () => {
    expect(isListingDateAcceptable(hoursFromNow(24 * 30), 72, now)).toBe(false);
    // ...even when no age limit was requested.
    expect(isListingDateAcceptable(hoursFromNow(24 * 30), null, now)).toBe(false);
  });

  it("tolerates a small future skew from a feed's own clock", () => {
    expect(isListingDateAcceptable(hoursFromNow(6), 72, now)).toBe(true);
  });

  it("keeps a row whose date is absent or unparseable", () => {
    expect(isListingDateAcceptable(null, 72, now)).toBe(true);
    expect(isListingDateAcceptable("not a date", 72, now)).toBe(true);
  });
});
