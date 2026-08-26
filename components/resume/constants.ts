import type { ResumeBasics, ResumeLink, ResumeExperience, ResumeProject, ResumeEducation, ResumeSkillGroup, ResumeCertification } from "./types";

export const emptyBasics: ResumeBasics = {
  fullName: "",
  title: "",
  email: "",
  phone: "",
};

/* Stable per-row identity for drag-reorder keys. crypto.randomUUID exists in
   every supported runtime (browser, node 19+, jsdom); the fallback keeps any
   older test environment alive. */
export const newRowId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}`;

export const emptyExperience = (): ResumeExperience => ({
  rowId: newRowId(),
  title: "",
  company: "",
  location: "",
  dates: "",
  links: [{ label: "", url: "" }],
  bullets: [""],
});

export const emptyProject = (): ResumeProject => ({
  rowId: newRowId(),
  name: "",
  location: "",
  stack: "",
  dates: "",
  links: [{ label: "", url: "" }],
  bullets: [""],
});

export const emptyEducation = (): ResumeEducation => ({
  rowId: newRowId(),
  school: "",
  degree: "",
  location: "",
  dates: "",
  details: "",
});

export const emptySkillGroup = (): ResumeSkillGroup => ({
  rowId: newRowId(),
  category: "",
  itemsText: "",
});

export const emptyCertification = (): ResumeCertification => ({
  rowId: newRowId(),
  name: "",
  url: "",
});

export const defaultLinks: ResumeLink[] = [
  { label: "LinkedIn", url: "" },
  { label: "GitHub", url: "" },
  { label: "Portfolio", url: "" },
];

export type SectionId =
  | "personal"
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills";

/** EN: Personal → Summary → Experience → Projects → Education → Skills */
const SECTION_IDS_EN: readonly SectionId[] = ["personal", "summary", "experience", "projects", "education", "skills"];

/** CN: Personal → Education → Experience → Projects → Skills (no Summary — matches LaTeX template order) */
const SECTION_IDS_CN: readonly SectionId[] = ["personal", "education", "experience", "projects", "skills"];

export function getSectionIds(locale: string): readonly SectionId[] {
  return locale === "zh-CN" ? SECTION_IDS_CN : SECTION_IDS_EN;
}
