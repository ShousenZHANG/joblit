import { describe, expect, it, beforeEach } from "vitest";
import {
  renderResumeCNTex,
  __resetTemplateCache,
  type RenderResumeCNInput,
} from "@/lib/server/latex/renderResumeCN";

const fullInput: RenderResumeCNInput = {
  candidate: {
    name: "张三",
    title: "前端开发工程师",
    email: "zhangsan@example.com",
    phone: "138-0000-0000",
    linkedinUrl: "https://linkedin.com/in/zhangsan",
    linkedinText: "LinkedIn",
  },
  photoBlock: "\\includegraphics[width=2.5cm]{photo}\\\\[4pt]",
  personalInfoLine: "男 $\\cdot$ 28 $\\cdot$ 5年经验",
  contactExtraLine: "",
  linksLine: " $\\cdot$ \\href{https://linkedin.com/in/zhangsan}{LinkedIn}",
  summary: "资深前端工程师",
  skills: [
    { label: "前端", items: ["React", "Vue", "TypeScript"] },
    { label: "后端", items: ["Node.js"] },
  ],
  experiences: [
    {
      title: "高级前端工程师",
      company: "字节跳动",
      location: "北京",
      dates: "2022.03 - 至今",
      links: [],
      bullets: ["主导前端架构升级", "性能优化提升50\\%"],
    },
  ],
  projects: [
    {
      name: "内部组件库",
      location: "北京",
      dates: "2023",
      stack: "React, TypeScript",
      links: [],
      bullets: ["设计并实现20+通用组件"],
    },
  ],
  education: [
    {
      schoolDegree: "北京大学 -- 计算机科学学士",
      location: "北京",
      dates: "2013.09 - 2017.06",
      detail: "GPA 3.8/4.0",
    },
  ],
};

describe("renderResumeCNTex", () => {
  beforeEach(() => {
    __resetTemplateCache();
  });

  it("renders valid output with all sections", () => {
    const output = renderResumeCNTex(fullInput);

    expect(output).toContain("张三");
    expect(output).toContain("zhangsan@example.com");
    expect(output).toContain("includegraphics");
    expect(output).toContain("男");
    // No unresolved tokens should leak into output.
    expect(output).not.toContain("{{");
    // CN resume template should not include summary text by default.
    expect(output).not.toContain(fullInput.summary);
  });

  it("contains expected section headers in the right order", () => {
    const output = renderResumeCNTex(fullInput);

    expect(output).toContain("教育背景");
    expect(output).toContain("工作经历");
    expect(output).toContain("项目经历");
    expect(output).toContain("技能/证书及其他");

    const educationIdx = output.indexOf("教育背景");
    const experienceIdx = output.indexOf("工作经历");
    const projectsIdx = output.indexOf("项目经历");
    const skillsIdx = output.indexOf("技能/证书及其他");

    expect(educationIdx).toBeGreaterThanOrEqual(0);
    expect(experienceIdx).toBeGreaterThan(educationIdx);
    expect(projectsIdx).toBeGreaterThan(experienceIdx);
    expect(skillsIdx).toBeGreaterThan(projectsIdx);
  });

  it("renders skills correctly", () => {
    const output = renderResumeCNTex(fullInput);

    expect(output).toContain("\\textbf{前端:} React, Vue, TypeScript");
    expect(output).toContain("\\textbf{后端:} Node.js");
  });

  it("renders experience with bullets", () => {
    const output = renderResumeCNTex(fullInput);

    expect(output).toContain("\\textbf{高级前端工程师}");
    expect(output).toContain("字节跳动");
    expect(output).toContain("\\item 主导前端架构升级");
  });

  it("omits optional sections when empty", () => {
    const minimal: RenderResumeCNInput = {
      candidate: {
        name: "李四",
        title: "工程师",
        email: "li@x.com",
        phone: "139",
      },
      photoBlock: "",
      personalInfoLine: "",
      contactExtraLine: "",
      linksLine: "",
      summary: "",
      skills: [{ label: "技能", items: ["Go"] }],
      experiences: [
        {
          title: "工程师",
          company: "公司",
          location: "上海",
          dates: "2024",
          bullets: ["开发功能"],
        },
      ],
      projects: [],
      education: [],
    };

    const output = renderResumeCNTex(minimal);

    // Skills and experience are required sections for the CN template.
    expect(output).toContain("技能/证书及其他");
    expect(output).toContain("工作经历");
    expect(output).not.toContain("项目经历");
    expect(output).not.toContain("教育背景");
    // No unresolved tokens should leak into output.
    expect(output).not.toContain("{{");

    // Required section order should remain stable even when optional sections are empty.
    const experienceIdx = output.indexOf("工作经历");
    const skillsIdx = output.indexOf("技能/证书及其他");
    expect(experienceIdx).toBeGreaterThanOrEqual(0);
    expect(skillsIdx).toBeGreaterThan(experienceIdx);
  });
});
