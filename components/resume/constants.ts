import type { ResumeBasics, ResumeLink, ResumeExperience, ResumeProject, ResumeEducation, ResumeSkillGroup } from "./types";

export const emptyBasics: ResumeBasics = {
  fullName: "",
  title: "",
  email: "",
  phone: "",
};

export const emptyExperience = (): ResumeExperience => ({
  title: "",
  company: "",
  location: "",
  dates: "",
  links: [{ label: "", url: "" }],
  bullets: [""],
});

export const emptyProject = (): ResumeProject => ({
  name: "",
  location: "",
  stack: "",
  dates: "",
  links: [{ label: "", url: "" }],
  bullets: [""],
});

export const emptyEducation = (): ResumeEducation => ({
  school: "",
  degree: "",
  location: "",
  dates: "",
  details: "",
});

export const emptySkillGroup = (): ResumeSkillGroup => ({
  category: "",
  itemsText: "",
});

export const defaultLinks: ResumeLink[] = [
  { label: "LinkedIn", url: "" },
  { label: "GitHub", url: "" },
  { label: "Portfolio", url: "" },
];

export const SECTION_IDS = ["personal", "summary", "experience", "projects", "education", "skills"] as const;
export type SectionId = typeof SECTION_IDS[number];

/** EN: Personal → Summary → Experience → Projects → Education → Skills */
const SECTION_IDS_EN: readonly SectionId[] = ["personal", "summary", "experience", "projects", "education", "skills"];

/** CN: Personal → Education → Experience → Projects → Skills (no Summary — matches LaTeX template order) */
const SECTION_IDS_CN: readonly SectionId[] = ["personal", "education", "experience", "projects", "skills"];

export function getSectionIds(locale: string): readonly SectionId[] {
  return locale === "zh-CN" ? SECTION_IDS_CN : SECTION_IDS_EN;
}
