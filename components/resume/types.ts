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

/* rowId: a client-only identity for drag-reorder and React keys. Immutable
   per-row edits spread it forward, so identity follows the ENTRY, not its
   position — drag drop-animations land correctly and focus/expanded state
   never jumps rows. buildPayload constructs API objects field-by-field, so
   rowId never reaches the server. */

export type ResumeExperience = {
  rowId: string;
  location: string;
  dates: string;
  title: string;
  company: string;
  links: ResumeLink[];
  bullets: string[];
};

export type ResumeProject = {
  rowId: string;
  name: string;
  location: string;
  stack: string;
  dates: string;
  links: ResumeLink[];
  bullets: string[];
};

export type ResumeEducation = {
  rowId: string;
  school: string;
  degree: string;
  location: string;
  dates: string;
  details?: string;
};

export type ResumeSkillGroup = {
  rowId: string;
  category: string;
  label?: string;
  itemsText: string;
};

export type ResumeSkillPayload = {
  category: string;
  items: string[];
};

export type ResumeCertification = {
  rowId: string;
  name: string;
  url: string;
};

export type ResumeProfilePayload = {
  id?: string;
  name?: string;
  locale?: string;
  basics?: ResumeBasics | null;
  links?: ResumeLink[] | null;
  summary?: string | null;
  // API shape — rowId is client-only identity and must never cross the wire.
  experiences?: Omit<ResumeExperience, "rowId">[] | null;
  projects?: Omit<ResumeProject, "rowId">[] | null;
  education?: Omit<ResumeEducation, "rowId">[] | null;
  skills?: ResumeSkillPayload[] | null;
  certifications?: Omit<ResumeCertification, "rowId">[] | null;
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
