import fs from "node:fs";
import path from "node:path";
import {
  replaceTokens,
  sanitizeRendered,
  renderBullets as sharedRenderBullets,
  renderLinks,
} from "./templateUtils";

type CandidateInfo = {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedinUrl?: string;
  linkedinText?: string;
  githubUrl?: string;
  githubText?: string;
  websiteUrl?: string;
  websiteText?: string;
};

type SkillsGroup = {
  label: string;
  items: string[];
};

type ProjectLink = {
  label: string;
  url: string;
};

type ExperienceEntry = {
  location: string;
  dates: string;
  title: string;
  company: string;
  links?: ProjectLink[];
  bullets: string[];
};

type ProjectEntry = {
  name: string;
  location: string;
  dates: string;
  stack: string;
  links: ProjectLink[];
  bullets: string[];
};

type EducationEntry = {
  location: string;
  dates: string;
  schoolDegree: string;
  detail?: string;
};

export type RenderResumeCNInput = {
  candidate: CandidateInfo;
  photoBlock: string;
  personalInfoLine: string;
  contactExtraLine: string;
  linksLine: string;
  summary: string;
  skills: SkillsGroup[];
  experiences: ExperienceEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
};

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "latexTemp",
  "Resume_CN",
  "main.tex",
);

let templateCache: string | undefined;

function readTemplate() {
  if (templateCache !== undefined) return templateCache;
  templateCache = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  return templateCache;
}

const replaceAll = replaceTokens;

function renderSkills(groups: SkillsGroup[]) {
  return groups
    .map((group) => {
      const items = group.items.join(", ");
      return `\\textbf{${group.label}:} ${items}`;
    })
    .join(" \\\\\n");
}

const renderBullets = sharedRenderBullets;
const renderProjectLinks = renderLinks;

function renderExperienceBlock(entry: ExperienceEntry) {
  const linksLine = renderProjectLinks(entry.links ?? []);
  let secondLine = entry.company.trim();
  if (linksLine) {
    secondLine = secondLine
      ? `${secondLine} \\enspace $\\cdot$ \\enspace ${linksLine}`
      : linksLine;
  }

  const lines = [
    `\\noindent\\textbf{${entry.title}} \\hfill ${entry.dates} \\\\`,
  ];
  if (secondLine) {
    lines.push(`${secondLine} \\\\`);
  }

  if (entry.bullets.length > 0) {
    // Tighten gap between experience header lines and first bullet.
    lines.push("\\vspace{-4pt}");
    lines.push("\\begin{itemize}[topsep=0pt]");
    lines.push(renderBullets(entry.bullets));
    lines.push("\\end{itemize}");
  }

  // Unified block spacing between experience entries / next section.
  lines.push("\\vspace{0.14cm}");
  return lines.join("\n");
}

function renderExperiences(entries: ExperienceEntry[]) {
  return entries.map((entry) => renderExperienceBlock(entry)).join("\n\n");
}

function renderEducationBlock(entry: EducationEntry) {
  const location = entry.location?.trim() ?? "";
  const dates = entry.dates.trim();
  const rightParts = [location, dates].filter((v) => v.length > 0);
  const rightLine = rightParts.join(" \\enspace $\\cdot$ \\enspace ");

  const lines = [`\\noindent\\textbf{${entry.schoolDegree}} \\hfill ${rightLine} \\\\`];

  const detailStr = entry.detail?.trim()
    ? `\\hspace*{14pt}${entry.detail.trim()}`
    : "";
  if (detailStr) {
    lines.push(`${detailStr} \\par`);
    // Only add extra spacing when there is a detail line; otherwise rely on section spacing.
    lines.push("\\vspace{0.14cm}");
  }
  return lines.join("\n");
}

function renderEducation(entries: EducationEntry[]) {
  return entries.map((entry) => renderEducationBlock(entry)).join("\n\n");
}

function renderProjectBlock(entry: ProjectEntry) {
  const linksLine = renderProjectLinks(entry.links);
  const stackPart = entry.stack.trim();
  const stackLineParts = [
    stackPart ? `\\textit{${stackPart}}` : "",
    linksLine,
  ].filter((v) => v.length > 0);
  const stackLine = stackLineParts.join(" \\;|\\; ");

  const lines = [
    `\\noindent\\textbf{${entry.name}} \\hfill ${entry.dates} \\\\`,
  ];
  if (stackLine) {
    lines.push(`${stackLine} \\\\`);
  }

  if (entry.bullets.length > 0) {
    // Tighten gap between project header lines and first bullet.
    // Keep consistent with experience bullet spacing.
    lines.push("\\vspace{-4pt}");
    lines.push("\\begin{itemize}[topsep=0pt]");
    lines.push(renderBullets(entry.bullets));
    lines.push("\\end{itemize}");
  }

  // Unified block spacing between project entries / next section.
  lines.push("\\vspace{0.14cm}");
  return lines.join("\n");
}

function renderProjects(entries: ProjectEntry[]) {
  return entries.map((entry) => renderProjectBlock(entry)).join("\n\n");
}

export function renderResumeCNTex(input: RenderResumeCNInput) {
  const template = readTemplate();

  // 个人总结 leads the page when present — the mainstream Chinese resume
  // convention — and vanishes without a trace when the profile has none.
  // (The mapper passed summary for months while the template had no token
  // for it, so the field silently never reached the PDF.)
  const trimmedSummary = input.summary.trim();
  const summarySection = trimmedSummary
    ? `\section{个人总结}

${trimmedSummary} \par`
    : "";

  const projectsSection =
    input.projects.length > 0
      ? `\\section{项目经历}\n\n${renderProjects(input.projects)}`
      : "";

  const educationSection =
    input.education.length > 0
      ? `\\section{教育背景}\n\n${renderEducation(input.education)}`
      : "";

  const rendered = replaceAll(template, {
    CANDIDATE_NAME: input.candidate.name,
    CANDIDATE_TITLE: input.candidate.title,
    CANDIDATE_EMAIL: input.candidate.email,
    CANDIDATE_PHONE: input.candidate.phone,
    PHOTO_BLOCK: input.photoBlock,
    SUMMARY_SECTION: summarySection,
    PERSONAL_INFO_LINE: input.personalInfoLine,
    CONTACT_EXTRA_LINE: input.contactExtraLine,
    LINKS_LINE: input.linksLine,
    SKILLS: renderSkills(input.skills),
    EXPERIENCE_SECTION: renderExperiences(input.experiences),
    PROJECTS_SECTION: projectsSection,
    EDUCATION_SECTION: educationSection,
  });

  return sanitizeRendered(rendered);
}

/** Reset internal template cache for testing only. */
export function __resetTemplateCache() {
  templateCache = undefined;
}
