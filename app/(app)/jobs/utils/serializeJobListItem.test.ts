import { describe, expect, it } from "vitest";
import type { JobListItem } from "@/lib/server/jobs/jobListService";
import { serializeJobListItem } from "./serializeJobListItem";

describe("serializeJobListItem", () => {
  it("preserves fit and provenance fields in the SSR hydration payload", () => {
    const item: JobListItem = {
      id: "job-1",
      jobUrl: "https://example.com/jobs/1",
      title: "Platform Engineer",
      company: "Example",
      location: "Remote",
      jobType: "Full-time",
      jobLevel: "Senior",
      salary: "$150k",
      workArrangement: "Remote",
      listingDate: new Date("2026-07-18T00:00:00.000Z"),
      status: "NEW",
      market: "GLOBAL",
      source: "remoteok",
      postingRisk: 25,
      postingRiskFlags: ["suspicious_domain"],
      fitScore: 82,
      fitVerdict: "STRONG",
      fitEligibility: "PASS",
      resumePdfUrl: null,
      resumePdfName: null,
      coverPdfUrl: null,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      updatedAt: new Date("2026-07-20T00:00:00.000Z"),
    };

    expect(serializeJobListItem(item)).toMatchObject({
      id: "job-1",
      market: "GLOBAL",
      source: "remoteok",
      postingRisk: 25,
      postingRiskFlags: ["suspicious_domain"],
      fitScore: 82,
      fitVerdict: "STRONG",
      fitEligibility: "PASS",
      listingDate: "2026-07-18T00:00:00.000Z",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    });
  });
});
