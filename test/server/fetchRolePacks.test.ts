import { describe, expect, it } from "vitest";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";

describe("fetch role packs", () => {
  it("expands software engineer to a related role pack", () => {
    const out = expandRoleQueries(["Software Engineer"]);
    expect(out).toEqual([
      "Software Engineer",
      "Software Developer",
      "Web Developer",
      "Full Stack Engineer",
      "Full Stack Developer",
      "Backend Engineer",
      "Backend Developer",
      "Full Stack Agentic Engineer",
      "AI Engineer",
      "AI Developer",
    ]);
  });

  it("dedupes roles while preserving order", () => {
    const out = expandRoleQueries(["Backend Engineer", "Software Engineer"]);
    expect(out[0]).toBe("Backend Engineer");
    expect(new Set(out).size).toBe(out.length);
  });

  it("resolves config aliases like swe", () => {
    const out = expandRoleQueries(["SWE"]);
    expect(out).toContain("Software Engineer");
    expect(out).toContain("Backend Engineer");
  });

  it("falls back to original role when no pack is defined", () => {
    const out = expandRoleQueries(["Bioinformatics Engineer"]);
    expect(out).toEqual(["Bioinformatics Engineer"]);
  });

  it("expands when query partially matches an alias phrase", () => {
    const out = expandRoleQueries(["Software Engineer Java"]);
    expect(out).toContain("Software Engineer Java");
    expect(out).toContain("Backend Engineer");
    expect(out).toContain("Software Engineer");
  });

  it("expands long-tail variants via token overlap", () => {
    const out = expandRoleQueries(["AI Python Engineer"]);
    expect(out).toContain("AI Python Engineer");
    expect(out).toContain("AI Engineer");
  });
});
