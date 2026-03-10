import { describe, expect, it } from "vitest";
import { mapResumeProfileCN } from "@/lib/server/latex/mapResumeProfileCN";

const fullProfile = {
  basics: {
    fullName: "张三",
    title: "前端开发工程师",
    email: "zhangsan@example.com",
    phone: "138-0000-0000",
    photoUrl: "https://example.com/photo.jpg",
    gender: "男",
    age: "28",
    identity: "5年经验",
  },
  links: [
    { label: "LinkedIn", url: "https://linkedin.com/in/zhangsan" },
    { label: "GitHub", url: "https://github.com/zhangsan" },
    { label: "Portfolio", url: "https://zhangsan.dev" },
  ],
  summary: "资深前端工程师，擅长 **React** 和 **TypeScript**",
  skills: [
    { label: "前端", items: ["React", "Vue", "TypeScript"] },
    { label: "后端", items: ["Node.js", "Go"] },
  ],
  experiences: [
    {
      title: "高级前端工程师",
      company: "字节跳动",
      location: "北京",
      dates: "2022.03 - 至今",
      links: [{ label: "产品", url: "https://product.example.com" }],
      bullets: ["主导前端架构升级", "性能优化提升 **50%**"],
    },
  ],
  projects: [
    {
      name: "内部组件库",
      location: "北京",
      dates: "2023",
      stack: "React, TypeScript",
      links: [{ label: "GitHub", url: "https://github.com/example/lib" }],
      bullets: ["设计并实现 20+ 通用组件"],
    },
  ],
  education: [
    {
      school: "北京大学",
      degree: "计算机科学学士",
      location: "北京",
      dates: "2013.09 - 2017.06",
      details: "GPA 3.8/4.0",
    },
  ],
};

describe("mapResumeProfileCN", () => {
  it("maps a full CN profile correctly", () => {
    const mapped = mapResumeProfileCN(fullProfile);

    // Candidate basics
    expect(mapped.candidate.name).toContain("张三");
    expect(mapped.candidate.email).toBe("zhangsan@example.com");
    expect(mapped.candidate.linkedinUrl).toContain("linkedin.com");
    expect(mapped.candidate.githubUrl).toContain("github.com");
    expect(mapped.candidate.websiteUrl).toContain("zhangsan.dev");

    // CN-specific fields
    expect(mapped.photoBlock).toContain("includegraphics");
    expect(mapped.photoBlock).toContain("photo");
    expect(mapped.personalInfoLine).toContain("男");
    expect(mapped.personalInfoLine).toContain("28");
    expect(mapped.personalInfoLine).toContain("5年经验");

    // Links line
    expect(mapped.linksLine).toContain("$\\cdot$");
    expect(mapped.linksLine).toContain("linkedin.com");

    // Skills
    expect(mapped.skills).toHaveLength(2);
    expect(mapped.skills[0]?.label).toContain("前端");

    // Experiences
    expect(mapped.experiences).toHaveLength(1);
    expect(mapped.experiences[0]?.company).toContain("字节跳动");
    expect(mapped.experiences[0]?.links).toHaveLength(1);

    // Projects
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0]?.name).toContain("内部组件库");

    // Education
    expect(mapped.education).toHaveLength(1);
    expect(mapped.education[0]?.schoolDegree).toContain("北京大学");
  });

  it("handles minimal profile — no CN-specific fields", () => {
    const mapped = mapResumeProfileCN({
      basics: {
        fullName: "李四",
        title: "后端工程师",
        email: "lisi@example.com",
        phone: "139-0000-0000",
      },
      links: [],
      summary: "",
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });

    expect(mapped.candidate.name).toContain("李四");
    expect(mapped.photoBlock).toBe("");
    expect(mapped.personalInfoLine).toBe("");
    expect(mapped.contactExtraLine).toBe("");
    expect(mapped.linksLine).toBe("");
    expect(mapped.skills).toEqual([]);
    expect(mapped.experiences).toEqual([]);
    expect(mapped.projects).toEqual([]);
    expect(mapped.education).toEqual([]);
  });

  it("includes only non-empty personal info parts", () => {
    const mapped = mapResumeProfileCN({
      basics: {
        fullName: "王五",
        title: "全栈",
        email: "w@x.com",
        phone: "137",
        gender: "女",
        identity: "3年经验",
        // age omitted
      },
      links: [],
      summary: "",
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });

    expect(mapped.personalInfoLine).toContain("女");
    expect(mapped.personalInfoLine).toContain("3年经验");
    // Should not have dangling separators for missing fields
    expect(mapped.personalInfoLine).not.toMatch(/\\cdot\$\s*\$\\cdot/);
    // No wechat/qq provided
    expect(mapped.contactExtraLine).toBe("");
  });
});
