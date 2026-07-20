import { describe, expect, it } from "vitest";
import { buildCompanyRoleKey } from "./companyRoleKey";

describe("buildCompanyRoleKey", () => {
  it("collapses seniority prefixes onto one key", () => {
    const a = buildCompanyRoleKey({ company: "Acme", title: "Backend Engineer" });
    const b = buildCompanyRoleKey({
      company: "Acme",
      title: "Senior Backend Engineer",
    });
    const c = buildCompanyRoleKey({
      company: "Acme",
      title: "Staff Backend Engineer",
    });

    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("ignores location and work-mode suffixes", () => {
    const base = buildCompanyRoleKey({ company: "Acme", title: "AI Engineer" });

    expect(
      buildCompanyRoleKey({ company: "Acme", title: "AI Engineer (Remote)" }),
    ).toBe(base);
    expect(
      buildCompanyRoleKey({ company: "Acme", title: "AI Engineer - Sydney" }),
    ).toBe(base);
    expect(
      buildCompanyRoleKey({ company: "Acme", title: "AI Engineer, Hybrid" }),
    ).toBe(base);
  });

  it("is insensitive to case, punctuation and token order", () => {
    const a = buildCompanyRoleKey({ company: "Acme", title: "Full-Stack Engineer" });
    const b = buildCompanyRoleKey({ company: "ACME", title: "engineer full stack" });

    expect(b).toBe(a);
  });

  it("normalizes company legal suffixes", () => {
    const a = buildCompanyRoleKey({ company: "Canva", title: "AI Engineer" });

    expect(buildCompanyRoleKey({ company: "Canva Pty Ltd", title: "AI Engineer" })).toBe(a);
    expect(buildCompanyRoleKey({ company: "Canva, Inc.", title: "AI Engineer" })).toBe(a);
  });

  it("keeps genuinely different roles apart", () => {
    const backend = buildCompanyRoleKey({ company: "Acme", title: "Backend Engineer" });
    const frontend = buildCompanyRoleKey({ company: "Acme", title: "Frontend Engineer" });

    expect(frontend).not.toBe(backend);
  });

  it("keeps the same role at different companies apart", () => {
    const acme = buildCompanyRoleKey({ company: "Acme", title: "AI Engineer" });
    const globex = buildCompanyRoleKey({ company: "Globex", title: "AI Engineer" });

    expect(globex).not.toBe(acme);
  });

  it("returns null without a company, since the key would not identify a posting", () => {
    for (const company of [null, undefined, "", "   "]) {
      expect(buildCompanyRoleKey({ company, title: "AI Engineer" })).toBeNull();
    }
  });

  it("returns null when the title carries no distinguishing token", () => {
    // "Senior (Remote)" is entirely seniority + work mode: nothing identifies
    // which opening it is, so keying on it would merge unrelated rows.
    expect(
      buildCompanyRoleKey({ company: "Acme", title: "Senior (Remote)" }),
    ).toBeNull();
    expect(buildCompanyRoleKey({ company: "Acme", title: "   " })).toBeNull();
  });

  it("handles Chinese titles, which carry no spaces to tokenize on", () => {
    const base = buildCompanyRoleKey({
      company: "字节跳动",
      title: "Java后端开发工程师",
    });

    expect(base).not.toBeNull();
    expect(
      buildCompanyRoleKey({ company: "字节跳动", title: "高级Java后端开发工程师" }),
    ).toBe(base);
    expect(
      buildCompanyRoleKey({ company: "字节跳动", title: "资深Java后端开发工程师" }),
    ).toBe(base);
  });

  it("keeps different Chinese roles apart", () => {
    const backend = buildCompanyRoleKey({
      company: "字节跳动",
      title: "Java后端开发工程师",
    });
    const frontend = buildCompanyRoleKey({
      company: "字节跳动",
      title: "前端开发工程师",
    });

    expect(frontend).not.toBe(backend);
  });

  it("produces a bounded key regardless of title length", () => {
    const key = buildCompanyRoleKey({
      company: "Acme",
      title: "Senior Staff Principal Distinguished Backend Platform Infrastructure Reliability Engineer for the Global Payments Organisation",
    });

    expect(key).not.toBeNull();
    expect(key!.length).toBeLessThanOrEqual(200);
  });
});
