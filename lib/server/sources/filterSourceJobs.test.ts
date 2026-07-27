import { describe, expect, it } from "vitest";

import { filterSourceJobs } from "./filterSourceJobs";
import type { RawSourceJob } from "./types";

function job(
  title: string,
  location: string | null = "Sydney, Australia",
  workArrangement: string | null = null,
  overrides: Partial<RawSourceJob> = {},
): RawSourceJob {
  return {
    jobUrl: `https://example.com/${encodeURIComponent(title)}`,
    title,
    company: "Acme",
    location,
    jobType: null,
    jobLevel: null,
    description: null,
    salary: null,
    workArrangement,
    listingDate: null,
    source: "remoteok",
    ...overrides,
  };
}

describe("filterSourceJobs — seniority in the base query", () => {
  // Measured before the fix: this corpus kept 12/16 for base "AI Engineer" and
  // 1/16 for "Senior AI Engineer". The matcher filtered the base query's tokens
  // through GENERIC_ROLE_TOKENS, which does not contain "senior", so the
  // seniority word survived as a signal the title had to literally contain.
  // The AU worker has always stripped it — this is GLOBAL catching up.
  const CORPUS = [
    "AI Engineer",
    "Senior AI Engineer",
    "Machine Learning Engineer",
    "AI Agent Engineer",
    "LLM Engineer",
    "Staff AI Engineer",
    "Lead Machine Learning Engineer",
    "Principal AI Engineer",
    "GenAI Engineer",
    "AI Platform Engineer",
    "Graduate AI Engineer",
    "Marketing Manager",
  ];

  function keptTitles(base: string, strictTitles: boolean) {
    return filterSourceJobs(
      CORPUS.map((title) => job(title, null, "Remote")),
      { queries: [base], baseQueries: [base], titleMatch: strictTitles ? "strict" : "relaxed" },
    ).map((row) => row.title);
  }

  it("does not require the title to repeat the seniority word", () => {
    const kept = keptTitles("Senior AI Engineer", true);

    expect(kept).toContain("AI Engineer");
    expect(kept).toContain("Machine Learning Engineer");
    // Staff and Principal outrank Senior; rejecting them was the sharpest
    // symptom of reading the level as a domain signal.
    expect(kept).toContain("Staff AI Engineer");
    expect(kept).toContain("Principal AI Engineer");
    expect(kept).not.toContain("Marketing Manager");
  });

  it("returns the same set with or without the seniority word", () => {
    expect(new Set(keptTitles("Senior AI Engineer", true))).toEqual(
      new Set(keptTitles("AI Engineer", true)),
    );
  });

  it("keeps a non-engineering title out regardless of strictness", () => {
    expect(keptTitles("Senior AI Engineer", false)).not.toContain("Marketing Manager");
  });
});

describe("filterSourceJobs — title match modes", () => {
  const rows = [
    job("AI Engineer", null, "Remote"),
    job("Machine Learning Engineer", null, "Remote"),
    job("Commercial Accountant", null, "Remote"),
  ];
  const base = { queries: ["AI Engineer"], baseQueries: ["AI Engineer"] };

  it("strict keeps the role family and drops everything else", () => {
    expect(filterSourceJobs(rows, { ...base, titleMatch: "strict" })).toEqual([
      rows[0],
      rows[1],
    ]);
  });

  it("off keeps every usable row, including unrelated roles", () => {
    expect(filterSourceJobs(rows, { ...base, titleMatch: "off" })).toEqual(rows);
  });

  it("off still applies the quality gates", () => {
    const withJunk = [...rows, job("Careers", null, "Remote")];
    expect(filterSourceJobs(withJunk, { ...base, titleMatch: "off" })).toEqual(rows);
  });

  it("off still applies location and freshness", () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const mixed = [
      job("AI Engineer", "Sydney, NSW"),
      job("AI Engineer", "Berlin, Germany"),
    ];
    expect(
      filterSourceJobs(mixed, {
        ...base,
        titleMatch: "off",
        location: "Sydney, New South Wales, Australia",
        now,
      }),
    ).toEqual([mixed[0]]);
  });

  it("defaults to strict when no mode is given", () => {
    expect(filterSourceJobs(rows, base)).toEqual(
      filterSourceJobs(rows, { ...base, titleMatch: "strict" }),
    );
  });

  // Public feeds have no server-side search, so "off" would otherwise import a
  // source's entire catalogue. resultsWanted was in the config all along and
  // the GLOBAL path never read it.
  it("caps the result set at resultsWanted", () => {
    expect(
      filterSourceJobs(rows, { ...base, titleMatch: "off", resultsWanted: 2 }),
    ).toEqual([rows[0], rows[1]]);
  });

  it("ignores a cap that is absent or not a positive number", () => {
    expect(
      filterSourceJobs(rows, { ...base, titleMatch: "off", resultsWanted: null }),
    ).toEqual(rows);
    expect(
      filterSourceJobs(rows, { ...base, titleMatch: "off", resultsWanted: 0 }),
    ).toEqual(rows);
  });
});

describe("filterSourceJobs — unusable rows", () => {
  // Measured before these gates: of six junk rows, three survived the filter.
  // AU has dropped all of them since it was written. A junk row that reaches
  // the Jobs list has to be deleted by hand, and a delete writes a permanent
  // DeletedJobUrl tombstone — so importing one is not a reversible mistake.
  const base = { queries: ["AI Engineer"], baseQueries: ["AI Engineer"] };

  it("drops a scraped index page masquerading as a title", () => {
    const rows = [
      job("AI Engineer", null, "Remote"),
      job("Careers", null, "Remote"),
      job("Search Results", null, "Remote"),
      job("Jobs", null, "Remote"),
    ];
    expect(filterSourceJobs(rows, base)).toEqual([rows[0]]);
  });

  it("drops a login wall captured in place of a description", () => {
    const rows = [
      job("AI Engineer", null, "Remote", { description: "Build agents." }),
      job("AI Engineer", null, "Remote", { description: "Sign in to view this job" }),
      job("AI Engineer", null, "Remote", { description: "Verify you're human" }),
    ];
    expect(filterSourceJobs(rows, base)).toEqual([rows[0]]);
  });

  it("drops a row whose link cannot be opened", () => {
    const rows = [
      job("AI Engineer", null, "Remote"),
      job("AI Engineer", null, "Remote", { jobUrl: "javascript:alert(1)" }),
      job("AI Engineer", null, "Remote", { jobUrl: "not a url" }),
      job("AI Engineer", null, "Remote", { jobUrl: "" }),
    ];
    expect(filterSourceJobs(rows, base)).toEqual([rows[0]]);
  });

  it("drops a listing dated in the future — that is a parse error, not a fresh role", () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const at = (hours: number) =>
      new Date(now.getTime() + hours * 3_600_000).toISOString();
    const rows = [
      job("AI Engineer", null, "Remote", { listingDate: at(-10) }),
      job("AI Engineer", null, "Remote", { listingDate: at(24 * 30) }),
    ];
    expect(filterSourceJobs(rows, { ...base, hoursOld: 72, now })).toEqual([rows[0]]);
  });

  it("still drops a future listing when no age limit was requested", () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const rows = [
      job("AI Engineer", null, "Remote", {
        listingDate: new Date(now.getTime() + 24 * 30 * 3_600_000).toISOString(),
      }),
    ];
    expect(filterSourceJobs(rows, { ...base, now })).toEqual([]);
  });

  it("allows a grace window on the old side for day-precision feeds", () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const rows = [
      job("AI Engineer", null, "Remote", {
        listingDate: new Date(now.getTime() - 80 * 3_600_000).toISOString(),
      }),
    ];
    expect(filterSourceJobs(rows, { ...base, hoursOld: 72, now })).toEqual(rows);
  });

  it("applies the gates even in source-only mode, where no query filters", () => {
    const rows = [
      job("AI Engineer", null, "Remote"),
      job("Careers", null, "Remote"),
    ];
    expect(
      filterSourceJobs(rows, { queries: [], queryMode: "source-only" }),
    ).toEqual([rows[0]]);
  });
});

describe("filterSourceJobs", () => {
  it("keeps only role-family matches and fails closed without queries", () => {
    const rows = [job("Senior AI Engineer"), job("Finance Manager")];

    expect(
      filterSourceJobs(rows, {
        queries: ["AI Engineer", "Machine Learning Engineer"],
        baseQueries: ["AI Engineer"],
      }),
    ).toEqual([rows[0]]);
    expect(filterSourceJobs(rows, { queries: [] })).toEqual([]);
  });

  it("skips only role matching for an explicit legacy source-only run", () => {
    const rows = [job("Commercial Accountant", "Remote")];

    expect(
      filterSourceJobs(rows, {
        queries: [],
        baseQueries: [],
        queryMode: "source-only",
      }),
    ).toEqual(rows);
  });

  it("preserves a base technology gate across expanded roles", () => {
    const rows = [job("Java Backend Engineer"), job("Backend Engineer")];

    expect(
      filterSourceJobs(rows, {
        queries: ["Java Backend Developer", "Backend Engineer", "API Engineer"],
        baseQueries: ["Java Backend Developer"],
      }),
    ).toEqual([rows[0]]);
  });

  it("accepts remote roles for a city search but rejects another explicit city", () => {
    const rows = [
      job("Software Engineer", "Melbourne, Australia"),
      job("Software Engineer", "Worldwide", "Remote"),
      job("Software Engineer", null, "Remote"),
      job("Software Engineer", "United States", "Remote"),
      job("Software Engineer", "Sydney, NSW"),
    ];

    expect(
      filterSourceJobs(rows, {
        queries: ["Software Engineer"],
        location: "Sydney, New South Wales, Australia",
      }),
    ).toEqual([rows[1], rows[2], rows[4]]);
  });

  it("applies custom title exclusions before import", () => {
    const rows = [job("Software Engineer Intern"), job("Software Engineer")];

    expect(
      filterSourceJobs(rows, {
        queries: ["Software Engineer"],
        excludeTitleTerms: ["intern"],
      }),
    ).toEqual([rows[1]]);
  });

  it("uses domain synonyms for a constrained AI role family", () => {
    const rows = [job("Machine Learning Engineer"), job("Software Engineer")];

    expect(
      filterSourceJobs(rows, {
        queries: ["AI Engineer", "Machine Learning Engineer"],
        baseQueries: ["AI Engineer"],
      }),
    ).toEqual([rows[0]]);
  });

  it("keeps the Power Platform product family without widening a platform search", () => {
    const rows = [
      job("Power Apps Developer"),
      job("Copilot Studio Developer"),
      job("Dynamics 365 Developer"),
      job("Platform Engineer"),
    ];

    expect(
      filterSourceJobs(rows, {
        queries: [
          "Power Platform Developer",
          "Power Apps Developer",
          "Copilot Studio Developer",
          "Dynamics 365 Developer",
        ],
        baseQueries: ["Power Platform Developer"],
      }),
    ).toEqual(rows.slice(0, 3));

    expect(
      filterSourceJobs(rows, {
        queries: ["Platform Engineer"],
        baseQueries: ["Platform Engineer"],
      }),
    ).toEqual([rows[3]]);
  });

  it("keeps unknown dates but removes parseable postings older than the selected window", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const rows = [
      job("Software Engineer", null, "Remote", {
        listingDate: "2026-07-20T00:30:00.000Z",
      }),
      job("Software Engineer", null, "Remote", {
        listingDate: "2026-07-18T00:00:00.000Z",
      }),
      job("Software Engineer", null, "Remote", { listingDate: null }),
      job("Software Engineer", null, "Remote", { listingDate: "unknown" }),
    ];

    expect(
      filterSourceJobs(rows, {
        queries: ["Software Engineer"],
        hoursOld: 24,
        now,
      }),
    ).toEqual([rows[0], rows[2], rows[3]]);
  });

  it("applies hard rights and minimum-experience exclusions without soft-match false positives", () => {
    const rows = [
      job("Software Engineer", null, "Remote", {
        description: "Applicants must be Australian citizens.",
      }),
      job("Software Engineer", null, "Remote", {
        description: "No specific citizenship is required.",
      }),
      job("Software Engineer", null, "Remote", {
        description: "Security clearance preferred.",
      }),
      job("Software Engineer", null, "Remote", {
        description: "You must have 4+ years of professional experience.",
      }),
      job("Software Engineer", null, "Remote", {
        description: "3+ years of professional experience.",
      }),
    ];

    expect(
      filterSourceJobs(rows, {
        queries: ["Software Engineer"],
        excludeDescriptionRules: [
          "identity_requirement",
          "clearance_requirement",
          "experience_requirement_4_plus",
        ],
      }),
    ).toEqual([rows[1], rows[2], rows[4]]);
  });
});
