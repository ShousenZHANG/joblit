import { describe, expect, it } from "vitest";
import { isSeekSearchUrl, mapSeekJob } from "./seekClient";

const ROW = {
  id: "92319306",
  title: "Software engineer",
  teaser: "Flynt is a new ERP platform.",
  companyName: "Sorensen Engineering",
  advertiser: { description: "Sorensen Engineering" },
  bulletPoints: ["Get in early", "See your work"],
  salaryLabel: "",
  workTypes: ["Contract/Temp"],
  listingDate: { dateTimeUtc: "2026-05-25T08:56:36.000Z" },
  locations: [{ label: "Brookvale, Sydney NSW" }],
  workArrangements: { displayText: "Hybrid" },
};

describe("seekClient.mapSeekJob", () => {
  it("maps a captured JobSearchV6 row to an import item", () => {
    const item = mapSeekJob(ROW);
    expect(item).not.toBeNull();
    expect(item!.jobUrl).toBe("https://au.seek.com/job/92319306");
    expect(item!.title).toBe("Software engineer");
    expect(item!.company).toBe("Sorensen Engineering");
    expect(item!.location).toBe("Brookvale, Sydney NSW");
    expect(item!.jobType).toBe("Contract/Temp");
    expect(item!.workArrangement).toBe("Hybrid");
    expect(item!.listingDate).toBe("2026-05-25T08:56:36.000Z");
    expect(item!.site).toBe("seek");
    expect(item!.description).toContain("Flynt");
    expect(item!.description).toContain("- Get in early");
  });

  it("falls back to companyName when advertiser is absent", () => {
    const item = mapSeekJob({ ...ROW, advertiser: undefined });
    expect(item!.company).toBe("Sorensen Engineering");
  });

  it("rejects rows without a numeric id or title (SSRF / junk guard)", () => {
    expect(mapSeekJob({ ...ROW, id: "abc" })).toBeNull();
    expect(mapSeekJob({ ...ROW, id: "", title: "x" })).toBeNull();
    expect(mapSeekJob({ ...ROW, title: "" })).toBeNull();
    expect(mapSeekJob(null)).toBeNull();
  });
});

describe("seekClient.isSeekSearchUrl", () => {
  it("matches Seek search pages only", () => {
    expect(isSeekSearchUrl("https://au.seek.com/jobs?keywords=x")).toBe(true);
    expect(isSeekSearchUrl("https://au.seek.com/software-engineer-jobs")).toBe(true);
    expect(isSeekSearchUrl("https://au.seek.com/job/123")).toBe(false);
    expect(isSeekSearchUrl("https://www.linkedin.com/jobs")).toBe(false);
  });
});
