import fs from "node:fs";
import path from "node:path";
import { escapeLatex, escapeLatexWithBold } from "./escapeLatex";
import { replaceLiteral, replaceTokens } from "./templateUtils";

type CoverCandidate = {
  name: string;
  title: string;
  phone: string;
  email: string;
  linkedinUrl?: string;
  linkedinText?: string;
};

type RenderCoverLetterInput = {
  candidate: CoverCandidate;
  company: string;
  role: string;
  candidateTitle?: string;
  subject?: string;
  date?: string;
  salutation?: string;
  paragraphOne: string;
  paragraphTwo: string;
  paragraphThree: string;
  closing?: string;
  signatureName?: string;
};

const TEMPLATE_ROOT = path.join(process.cwd(), "latexTemp", "Cover_letter");

const templateCache = new Map<string, string>();

/**
 * Cached like the resume renderer's, which this one never got. Two synchronous
 * disk reads happened on every call — including every DRAFT import, which then
 * throws the rendered LaTeX away.
 */
function readTemplate(relPath: string) {
  const absolutePath = path.join(TEMPLATE_ROOT, relPath);
  const cached = templateCache.get(absolutePath);
  if (cached !== undefined) return cached;
  const loaded = fs.readFileSync(absolutePath, "utf-8");
  templateCache.set(absolutePath, loaded);
  return loaded;
}

const replaceAll = replaceTokens;

function normalizeLine(value: string, fallback = "-") {
  const text = value.trim();
  return text ? text : fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCoverSubject(raw: string | undefined, role: string, candidateName: string) {
  let text = (raw || "").trim();
  if (!text) return `Application for ${role}`;

  const escapedName = escapeRegExp(candidateName.trim());
  if (escapedName) {
    const trailingName = new RegExp(`\\s*[-|:]\\s*${escapedName}\\s*$`, "i");
    text = text.replace(trailingName, "").trim();
  }
  return text || `Application for ${role}`;
}

function normalizeCoverSalutation(raw: string | undefined, company: string) {
  let text = (raw || "").trim();
  if (!text) return `Hiring Team at ${company}`;

  // Template already prepends "Dear " and appends ",".
  text = text.replace(/^dear\s+/i, "");
  text = text.replace(/,+\s*$/g, "");
  return text.trim() || `Hiring Team at ${company}`;
}

export function renderCoverLetterTex(input: RenderCoverLetterInput) {
  const main = readTemplate("resume.tex");
  const content = readTemplate("content.tex");

  const renderedContent = replaceAll(content, {
    CANDIDATE_NAME: normalizeLine(escapeLatex(input.candidate.name)),
    CANDIDATE_TITLE: normalizeLine(
      escapeLatex(input.candidateTitle?.trim() || input.candidate.title),
    ),
    CANDIDATE_PHONE: normalizeLine(escapeLatex(input.candidate.phone)),
    CANDIDATE_EMAIL: normalizeLine(escapeLatex(input.candidate.email)),
    CANDIDATE_LINKEDIN_URL: normalizeLine(escapeLatex(input.candidate.linkedinUrl || "#"), "#"),
    CANDIDATE_LINKEDIN_TEXT: normalizeLine(
      escapeLatex(input.candidate.linkedinText || "LinkedIn"),
      "LinkedIn",
    ),
    COVER_COMPANY: normalizeLine(escapeLatex(input.company)),
    COVER_ROLE: normalizeLine(escapeLatex(input.role)),
    COVER_SUBJECT: normalizeLine(
      escapeLatex(normalizeCoverSubject(input.subject, input.role, input.candidate.name)),
      `Application for ${escapeLatex(input.role)}`,
    ),
    COVER_DATE: input.date?.trim() ? escapeLatex(input.date) : "\\today",
    COVER_SALUTATION: normalizeLine(
      escapeLatex(normalizeCoverSalutation(input.salutation, input.company)),
      `Hiring Team at ${escapeLatex(input.company)}`,
    ),
    COVER_BODY: escapeLatexWithBold(input.paragraphOne),
    COVER_P2: escapeLatexWithBold(input.paragraphTwo),
    COVER_P3: escapeLatexWithBold(input.paragraphThree),
    COVER_CLOSING: normalizeLine(
      escapeLatex(input.closing || "Yours sincerely,"),
      "Yours sincerely,",
    ),
    COVER_SIGNATURE_NAME: normalizeLine(
      escapeLatex(input.signatureName || input.candidate.name),
      normalizeLine(escapeLatex(input.candidate.name), "Candidate"),
    ),
  });

  return replaceLiteral(main, "\\input{content}", renderedContent);
}
