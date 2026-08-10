import fs from "node:fs";
import path from "node:path";
import {
  replaceLiteral,
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

type ExperienceEntry = {
  location: string;
  dates: string;
  title: string;
  company: string;
  links?: ProjectLink[];
  bullets: string[];
};

type ProjectLink = {
  label: string;
  url: string;
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

type RenderResumeInput = {
  candidate: CandidateInfo;
  summary: string;
  skills: SkillsGroup[];
  experiences: ExperienceEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
  lastUpdated?: string;
};

const TEMPLATE_ROOT = path.join(process.cwd(), "latexTemp", "Resume");
const templateCache = new Map<string, string>();

function readTemplate(relPath: string) {
  const absolutePath = path.join(TEMPLATE_ROOT, relPath);
  const cached = templateCache.get(absolutePath);
  if (cached !== undefined) return cached;
  const loaded = fs.readFileSync(absolutePath, "utf-8");
  templateCache.set(absolutePath, loaded);
  return loaded;
}

const replaceAll = replaceTokens;

function renderSkills(groups: SkillsGroup[]) {
  return groups
    .map((group) => {
      const items = group.items.join(", ");
      return `\\textbf{${group.label}:} ${items} \\\\`;
    })
    .join("\n");
}

const renderBullets = sharedRenderBullets;

function formatExperienceMeta(location: string, dates: string) {
  const loc = location.trim();
  const when = dates.trim();
  if (loc && when) {
    return `${loc} \\\\ ${when}`;
  }
  return loc || when || "~";
}

function renderExperienceBlock(entry: ExperienceEntry) {
  const meta = formatExperienceMeta(entry.location, entry.dates);
  const linksLine = renderProjectLinks(entry.links ?? []);
  const companyLine = linksLine ? `${entry.company} \\;|\\; ${linksLine}` : entry.company;
  const header = `\\begin{twocolentry}{\n    ${meta}\n}\n  \\textbf{${entry.title}} \\\\\n  ${companyLine}\n\\end{twocolentry}`;

  if (entry.bullets.length === 0) {
    return header;
  }

  return `${header}\n\n\\vspace{0.10 cm}\n\\begin{onecolentry}\n\\begin{highlights}\n${renderBullets(entry.bullets)}\n\\end{highlights}\n\\end{onecolentry}`;
}

function renderExperiences(entries: ExperienceEntry[]) {
  return entries
    .map((entry, index) => {
      const spacer = index < entries.length - 1 ? "\n\n\\vspace{0.25 cm}\n" : "";
      return `${renderExperienceBlock(entry)}${spacer}`;
    })
    .join("\n");
}

function formatEducationMeta(location: string, dates: string) {
  const loc = location.trim();
  const when = dates.trim();
  if (loc && when) {
    return `${loc} \\\\ ${when}`;
  }
  return loc || when || "~";
}

function renderEducationBlock(entry: EducationEntry) {
  const meta = formatEducationMeta(entry.location, entry.dates);
  const hasDetail = entry.detail?.trim().length;
  const detailLine = hasDetail ? `\n  \\textit{${entry.detail}}` : "";
  const detailBreak = hasDetail ? " \\\\" : "";

  return `\\begin{twocolentry}{\n    ${meta}\n}\n  \\textbf{${entry.schoolDegree}}${detailBreak}${detailLine}\n\\end{twocolentry}`;
}

function renderEducation(entries: EducationEntry[]) {
  return entries
    .map((entry, index) => {
      const spacer = index < entries.length - 1 ? "\n\n\\vspace{0.1cm}\n" : "";
      return `${renderEducationBlock(entry)}${spacer}`;
    })
    .join("\n");
}

function renderEducationSection(entries: EducationEntry[]) {
  if (entries.length === 0) return "";
  return `\\section{Education}\n\\vspace{0.1cm}\n\n${renderEducation(entries)}`;
}

function formatProjectMeta(location: string, dates: string) {
  const loc = location.trim();
  const when = dates.trim();
  if (loc && when) {
    return `${loc} \\\\ ${when}`;
  }
  return loc || when || "~";
}

const renderProjectLinks = renderLinks;

function renderProjectStackLine(entry: ProjectEntry) {
  const stack = entry.stack.trim();
  const linkLine = renderProjectLinks(entry.links);
  if (!stack && !linkLine) return "";
  const stackPart = stack ? `\\textit{${stack}}` : "";
  const separator = stack && linkLine ? " \\;|\\; " : "";
  return `${stackPart}${separator}${linkLine}`;
}

function renderProjectBlock(entry: ProjectEntry) {
  const meta = formatProjectMeta(entry.location, entry.dates);
  const stackLine = renderProjectStackLine(entry);
  const stackSection = stackLine ? ` \\\\\n  ${stackLine}` : "";
  const header = `\\begin{twocolentry}{\n    ${meta}\n}\n  \\textbf{${entry.name}}${stackSection}\n\\end{twocolentry}`;

  if (entry.bullets.length === 0) {
    return header;
  }

  return `${header}\n\n\\vspace{0.10 cm}\n\\begin{onecolentry}\n\\begin{highlights}\n${renderBullets(entry.bullets)}\n\\end{highlights}\n\\end{onecolentry}`;
}

function renderProjects(entries: ProjectEntry[]) {
  return entries
    .map((entry, index) => {
      const spacer = index < entries.length - 1 ? "\n\n\\vspace{0.25 cm}\n" : "";
      return `${renderProjectBlock(entry)}${spacer}`;
    })
    .join("\n");
}

function renderProjectsSection(entries: ProjectEntry[]) {
  if (entries.length === 0) return "";
  return `\\section{Projects}\n\\vspace{0.1cm}\n\n${renderProjects(entries)}`;
}

export function renderResumeTex(input: RenderResumeInput) {
  const main = readTemplate("main.tex");
  const summary = readTemplate(path.join("sections", "summary.tex"));
  const skills = readTemplate(path.join("sections", "skills.tex"));
  const experience = readTemplate(path.join("sections", "experience.tex"));

  const summaryRendered = replaceAll(summary, {
    SUMMARY: input.summary,
  });

  const skillsRendered = replaceAll(skills, {
    SKILLS: renderSkills(input.skills),
  });

  const experienceRendered = replaceAll(experience, {
    EXPERIENCE_SECTION: renderExperiences(input.experiences),
  });

  const projectsRendered = renderProjectsSection(input.projects);

  const educationRendered = renderEducationSection(input.education);

  const withTokens = replaceAll(main, {
    CANDIDATE_NAME: input.candidate.name,
    CANDIDATE_TITLE: input.candidate.title,
    CANDIDATE_EMAIL: input.candidate.email,
    CANDIDATE_PHONE: input.candidate.phone,
    CANDIDATE_LINKEDIN_URL: input.candidate.linkedinUrl ?? "",
    CANDIDATE_LINKEDIN_TEXT: input.candidate.linkedinText ?? "",
    CANDIDATE_GITHUB_URL: input.candidate.githubUrl ?? "",
    CANDIDATE_GITHUB_TEXT: input.candidate.githubText ?? "",
    CANDIDATE_WEBSITE_URL: input.candidate.websiteUrl ?? "",
    CANDIDATE_WEBSITE_TEXT: input.candidate.websiteText ?? "",
    LAST_UPDATED: input.lastUpdated ?? "",
    PROJECTS_SECTION: projectsRendered,
    EDUCATION_SECTION: educationRendered,
  });
  // Not String.replace: it reads `$&`, `` $` `` and `$'` out of the REPLACEMENT
  // text, and every one of these replacements is user-authored resume content
  // that escapeLatex has filled with `\$`. A candidate whose bullet contained
  // the wrong two characters could splice the template's own preamble into the
  // middle of their resume.
  const rendered = [
    ["\\input{sections/summary.tex}", summaryRendered],
    ["\\input{sections/skills.tex}", skillsRendered],
    ["\\input{sections/experience.tex}", experienceRendered],
  ].reduce(
    (tex, [placeholder, value]) => replaceLiteral(tex, placeholder, value),
    withTokens,
  );

  return sanitizeRendered(rendered);
}
