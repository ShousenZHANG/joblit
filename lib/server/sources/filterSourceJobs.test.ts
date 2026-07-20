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
