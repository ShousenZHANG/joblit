import { describe, it, expect } from "vitest";
import { flattenProfile } from "./extensionProfile";
import type { ResumeProfile } from "@/lib/shared/schemas/resumeProfile";

const sampleProfile: ResumeProfile = {
  locale: "en-AU",
  summary: "Full-stack developer with 5 years of experience",
  basics: {
    fullName: "John Doe",
    title: "Senior Software Engineer",
    email: "john@example.com",
    phone: "+61 400 000 000",
    location: "Sydney, Australia",
    photoUrl: null,
    gender: null,
    age: null,
    identity: null,
    availabilityMonth: "2026-05",
    wechat: null,
    qq: null,
  },
  links: [
    { label: "LinkedIn", url: "https://linkedin.com/in/johndoe" },
    { label: "GitHub", url: "https://github.com/johndoe" },
    { label: "Portfolio", url: "https://johndoe.dev" },
  ],
  skills: [
    { category: "Languages", items: ["TypeScript", "Python", "Go"] },
    { category: "Frameworks", items: ["React", "Next.js", "Node.js"] },
  ],
  experiences: [
    {
      company: "TechCorp",
      title: "Senior Engineer",
      location: "Sydney",
      dates: "2023 – Present",
      bullets: ["Led team of 5", "Built microservices"],
    },
    {
      company: "StartupCo",
      title: "Software Engineer",
      location: "Melbourne",
      dates: "2021 – 2023",
      bullets: ["Full-stack development"],
    },
  ],
  education: [
    {
      school: "University of Sydney",
      degree: "Bachelor of Computer Science",
      location: "Sydney",
      dates: "2017 – 2021",
      details: "GPA: 3.8/4.0",
    },
  ],
  projects: null,
};

describe("flattenProfile", () => {
  it("extracts basic fields", () => {
    const flat = flattenProfile(sampleProfile);
    expect(flat.fullName).toBe("John Doe");
    expect(flat.email).toBe("john@example.com");
    expect(flat.phone).toBe("+61 400 000 000");
    expect(flat.location).toBe("Sydney, Australia");
    expect(flat.currentTitle).toBe("Senior Software Engineer");
  });

  it("extracts link URLs by label", () => {
    const flat = flattenProfile(sampleProfile);
    expect(flat.linkedinUrl).toBe("https://linkedin.com/in/johndoe");
    expect(flat.githubUrl).toBe("https://github.com/johndoe");
    expect(flat.portfolioUrl).toBe("https://johndoe.dev");
  });

  it("extracts current company from first experience", () => {
    const flat = flattenProfile(sampleProfile);
    expect(flat.currentCompany).toBe("TechCorp");
  });

  it("extracts education fields from first entry", () => {
    const flat = flattenProfile(sampleProfile);
    expect(flat.schoolName).toBe("University of Sydney");
    expect(flat.degree).toBe("Bachelor of Computer Science");
  });

  it("joins skills as comma-separated string", () => {
    const flat = flattenProfile(sampleProfile);
    expect(flat.skills).toContain("TypeScript");
    expect(flat.skills).toContain("React");
  });

  it("includes summary", () => {
    const flat = flattenProfile(sampleProfile);
    expect(flat.summary).toBe("Full-stack developer with 5 years of experience");
  });

  it("handles null/undefined gracefully", () => {
    const flat = flattenProfile({});
    expect(flat.fullName).toBe("");
    expect(flat.email).toBe("");
    expect(flat.linkedinUrl).toBe("");
    expect(flat.currentCompany).toBe("");
    expect(flat.skills).toBe("");
  });

  it("handles CN-specific fields", () => {
    const cnProfile: ResumeProfile = {
      basics: {
        fullName: "张三",
        title: "高级工程师",
        email: "zhangsan@example.com",
        phone: "13800138000",
        wechat: "zhangsan_wx",
        qq: "12345678",
        gender: "男",
        age: "28",
        identity: "汉族",
      },
    };
    const flat = flattenProfile(cnProfile);
    expect(flat.wechat).toBe("zhangsan_wx");
    expect(flat.qq).toBe("12345678");
    expect(flat.gender).toBe("男");
  });
});
