export type ResumeBasics = {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  photoUrl?: string;
  identity?: string;
  availabilityMonth?: string;
  wechat?: string;
  qq?: string;
};

export type ResumeLink = {
  label: string;
  url: string;
};

export type ResumeExperience = {
  location: string;
  dates: string;
  title: string;
  company: string;
  links: ResumeLink[];
  bullets: string[];
};

export type ResumeProject = {
  name: string;
  location: string;
  stack: string;
  dates: string;
  links: ResumeLink[];
  bullets: string[];
};

export type ResumeEducation = {
  school: string;
  degree: string;
  location: string;
  dates: string;
  details?: string;
};

export type ResumeSkillGroup = {
  category: string;
  label?: string;
  itemsText: string;
};

export type ResumeSkillPayload = {
  category: string;
  items: string[];
};

export type ResumeProfilePayload = {
  id?: string;
  name?: string;
  locale?: string;
  basics?: ResumeBasics | null;
  links?: ResumeLink[] | null;
  summary?: string | null;
  experiences?: ResumeExperience[] | null;
  projects?: ResumeProject[] | null;
  education?: ResumeEducation[] | null;
  skills?: ResumeSkillPayload[] | null;
};

export type ResumeProfileSummary = {
  id: string;
  name: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
};

export type ReorderSection = "experience" | "project" | "education" | "skill";

export type PreviewStatus = "idle" | "loading" | "ready" | "error";
