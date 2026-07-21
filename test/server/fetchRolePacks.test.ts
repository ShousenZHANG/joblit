import { describe, expect, it } from "vitest";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";

describe("fetch role packs", () => {
  it("expands software engineer to a related role pack", () => {
    const out = expandRoleQueries(["Software Engineer"]);
    expect(out).toEqual([
      "Software Engineer",
      "Software Developer",
      "Application Developer",
      "Web Developer",
      "Forward Deployed Engineer",
      "Agent Engineer",
      "Solutions Architect",
      "Full Stack Engineer",
      "AI Engineer",
      "AI Agent Engineer",
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
    expect(out).toContain("Forward Deployed Engineer");
  });

  it("falls back to original role when no pack is defined", () => {
    const out = expandRoleQueries(["Bioinformatics Engineer"]);
    expect(out).toEqual(["Bioinformatics Engineer"]);
  });

  it("expands when query partially matches an alias phrase", () => {
    const out = expandRoleQueries(["Software Engineer Java"]);
    expect(out).toContain("Software Engineer Java");
    expect(out).toContain("Forward Deployed Engineer");
    expect(out).toContain("Software Engineer");
  });

  it("expands long-tail variants via token overlap", () => {
    const out = expandRoleQueries(["AI Python Engineer"]);
    expect(out).toContain("AI Python Engineer");
    expect(out).toContain("AI Engineer");
  });

  it("expands Power Platform titles to the Microsoft/Copilot ecosystem pack", () => {
    const out = expandRoleQueries(["Power Platform Developer"]);
    expect(out).toContain("Power Platform Developer");
    expect(out).toContain("Copilot Studio Developer");
    expect(out).toContain("Power Apps Developer");
    expect(out).toContain("Power Automate Developer");
    expect(out).toContain("Dynamics 365 Developer");
    // Bridges toward the user's AI / full-stack identity.
    expect(out).toContain("AI Engineer");
  });

  it("expands an AI search across its own domain and the sibling engineering roles", () => {
    const out = expandRoleQueries(["AI Engineer"]);
    expect(out).toContain("AI Agent Engineer");
    expect(out).toContain("AI Full Stack Engineer");
    expect(out).toContain("Machine Learning Engineer");
    expect(out).toContain("Data Scientist");
    expect(out).toContain("MLOps Engineer");
    // These were dropped while the worker's base gate rejected every generic
    // engineering title on a domain search, which made requesting them pure
    // waste. The gate now defers to the include filter for a domain-only base
    // query, so someone hiring into AI sees adjacent engineering roles again.
    expect(out).toContain("Software Engineer");
    expect(out).toContain("Full Stack Engineer");
    expect(out).toContain("Backend Engineer");
  });

  it("resolves Copilot Studio via its alias", () => {
    const out = expandRoleQueries(["Copilot Studio Developer"]);
    expect(out).toContain("Copilot Studio Developer");
    expect(out).toContain("Power Platform Developer");
  });

  it("matches a seniority-prefixed Power Platform variant", () => {
    const out = expandRoleQueries(["Senior Power Platform Engineer"]);
    expect(out).toContain("Senior Power Platform Engineer");
    expect(out).toContain("Power Platform Developer");
    expect(out).toContain("Copilot Studio Developer");
  });
});
