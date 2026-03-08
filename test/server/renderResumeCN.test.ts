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
  photoBlock: "\\includegraphics[width=2.5cm]{https://example.com/photo.jpg}\\\\[4pt]",
  personalInfoLine: "男 $|$ 28 $|$ 5年经验",
  contactExtraLine: " \\enspace $|$ \\enspace 微信: zhangsan\\_wx \\enspace $|$ \\enspace QQ: 123456789",
  linksLine: " $|$ \\href{https://linkedin.com/in/zhangsan}{LinkedIn}",
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
    expect(output).toContain("zhangsan\\_wx");
  });

  it("contains expected section headers", () => {
    const output = renderResumeCNTex(fullInput);

    expect(output).toContain("专业技能");
    expect(output).toContain("工作经历");
    expect(output).toContain("项目经历");
    expect(output).toContain("教育背景");
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

    expect(output).toContain("专业技能");
    expect(output).toContain("工作经历");
    expect(output).not.toContain("项目经历");
    expect(output).not.toContain("教育背景");
    expect(output).not.toContain("求职意向");
  });
});
