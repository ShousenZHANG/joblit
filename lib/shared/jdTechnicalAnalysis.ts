import { extractSkillMentions } from "./skillsGazetteer";

export const TECH_REQUIREMENT_PRIORITIES = [
  "REQUIRED",
  "CORE",
  "PREFERRED",
  "MENTIONED",
] as const;
export type TechRequirementPriority =
  (typeof TECH_REQUIREMENT_PRIORITIES)[number];

export type TechnicalRequirement = {
  skill: string;
  priority: TechRequirementPriority;
  isGate: boolean;
  evidence: string;
  aliases: string[];
};

export const STRUCTURAL_GATE_KINDS = [
  "WORK_RIGHTS",
  "CLEARANCE",
  "LICENCE",
  "LOCATION",
  "EXPERIENCE",
] as const;
export type StructuralGateKind = (typeof STRUCTURAL_GATE_KINDS)[number];
export type StructuralGateSignal = {
  kind: StructuralGateKind;
  requirement: string;
  evidence: string;
};

type SectionKind =
  | "neutral"
  | "required"
  | "gate"
  | "responsibility"
  | "preferred"
  | "ignored";

const PRIORITY_RANK: Record<TechRequirementPriority, number> = {
  REQUIRED: 4,
  CORE: 3,
  PREFERRED: 2,
  MENTIONED: 1,
};

const REQUIREMENT_LANGUAGE_RE =
  /\b(must(?:\s+have)?|require(?:d|s)?|mandatory|essential|minimum|at least|need(?:ed|s)?|proven|strong proficiency|deep expertise|hands-on experience)\b/i;
const EXPLICIT_GATE_RE =
  /\b(must(?:\s+have)?|require(?:d|s)?|mandatory|essential|minimum|at least|need(?:ed|s)?)\b/i;
const SOFT_REQUIREMENT_RE =
  /\b(preferred|nice[- ]to[- ]have|bonus|desirable|advantageous|a plus|ideally|optional)\b/i;
const NEGATED_REQUIREMENT_RE =
  /\b(no (?:prior |previous )?(?:\w+\s+){0,5}(?:experience|knowledge)(?: is)? required|no\s+(?:\w+\s+){0,5}required|(?:experience|knowledge)(?: is)? not required|not (?:required|mandatory|essential))\b/i;
const RESPONSIBILITY_RE =
  /\b(build|develop|design|deliver|implement|operate|maintain|scale|lead|own|architect|deploy|migrate|integrate|automate|monitor|optimise|optimize|troubleshoot)\b/i;
const STRUCTURAL_NEGATION_RE =
  /\b(?:is|are|was|were)?\s*not\s+(?:\w+\s+){0,4}(?:required|necessary|essential|mandatory)\b|\bno\s+(?:prior\s+)?(?:\w+\s+){0,4}(?:is\s+)?required\b|\bwe do not require\b/i;
const SPONSORSHIP_AVAILABLE_RE =
  /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)|\bwe\s+(?:can|do|will)\s+sponsor\b|\bsponsorship support\b/i;
const WORK_RIGHTS_RE =
  /\b(?:citizen(?:ship)?|permanent resident|right(?:s)? to work|work right(?:s)?|authori[sz](?:ed|ation) to work|eligible to work|visa sponsorship|without sponsorship|no sponsorship)\b/i;
const WORK_RIGHTS_INTRINSIC_RE =
  /\b(?:citizens? only|permanent residents? only|no (?:visa )?sponsorship|without (?:visa )?sponsorship|unrestricted work rights)\b/i;
const CLEARANCE_RE =
  /\b(?:security clearance|clearance required|baseline clearance|negative vetting|nv1|nv2|public trust|secret clearance|top secret|ts\/sci)\b/i;
const LICENCE_RE =
  /\b(?:(?:valid|current)\s+)?(?:driver'?s?|professional|practising)\s+licen[cs]e\b|\blicen[cs]e to practise\b/i;
const LOCATION_RE =
  /\b(?:on[- ]site|in[- ]office|office[- ]based|based in|located in|relocat(?:e|ion)|commut(?:e|ing))\b/i;
const LOCATION_INTRINSIC_RE =
  /\b(?:(?:fully|100%)\s+on[- ]site|on[- ]site role|\d+\s+days?\s+(?:per|a)\s+week\s+(?:on[- ]site|in[- ]office))\b/i;
const YEARS_RE =
  /\b(\d{1,2})(?:\s*(?:-|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/i;
const EXPERIENCE_CONTEXT_RE =
  /\b(?:experience|background|track record|professional|industry|role|position|field|hands-on)\b/i;

const HEADING_PATTERNS: Array<{
  kind: SectionKind;
  pattern: RegExp;
}> = [
  {
    kind: "gate",
    pattern: /^(must[- ]haves?|mandatory|essential requirements?|minimum requirements?)$/i,
  },
  {
    kind: "required",
    pattern:
      /^(requirements?|qualifications?|required skills?|technical skills?|what you(?:'|’)ll bring|what you bring|about you|your profile|skills and experience)$/i,
  },
  {
    kind: "responsibility",
    pattern:
      /^(responsibilities|what you(?:'|’)ll do|what you will do|the role|role overview|key accountabilities|day[- ]to[- ]day)$/i,
  },
  {
    kind: "preferred",
    pattern:
      /^(preferred(?: qualifications| skills)?|nice[- ]to[- ]haves?|bonus points?|desirable|good to have)$/i,
  },
  {
    kind: "ignored",
    pattern:
      /^(about (?:us|the company)|company|our company|benefits?|perks?|what we offer|why join us|culture|equal opportunity|diversity)$/i,
  },
];

function cleanHeading(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/^[#>*\s-]+/, "")
    .replace(/[*_`]/g, "")
    .replace(/[:\s]+$/, "")
    .trim();
}

function parseHeading(
  line: string,
): { kind: SectionKind; remainder: string } | null {
  const cleaned = cleanHeading(line);
  if (!cleaned || cleaned.length > 160) return null;

  const colon = cleaned.indexOf(":");
  const heading = colon >= 0 ? cleaned.slice(0, colon).trim() : cleaned;
  const remainder = colon >= 0 ? cleaned.slice(colon + 1).trim() : "";
  for (const candidate of HEADING_PATTERNS) {
    if (candidate.pattern.test(heading)) {
      return { kind: candidate.kind, remainder };
    }
  }
  return null;
}

function splitEvidence(line: string): string[] {
  return line
    .split(/\s*[;•]\s*|[.!?]\s+(?=[A-Z0-9])/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function classifyPriority(
  evidence: string,
  section: SectionKind,
): { priority: TechRequirementPriority; isGate: boolean } {
  if (NEGATED_REQUIREMENT_RE.test(evidence)) {
    return { priority: "MENTIONED", isGate: false };
  }
  if (SOFT_REQUIREMENT_RE.test(evidence) || section === "preferred") {
    return { priority: "PREFERRED", isGate: false };
  }
  if (EXPLICIT_GATE_RE.test(evidence)) {
    return { priority: "REQUIRED", isGate: true };
  }
  if (REQUIREMENT_LANGUAGE_RE.test(evidence)) {
    return { priority: "REQUIRED", isGate: false };
  }
  if (section === "gate") {
    return { priority: "REQUIRED", isGate: true };
  }
  if (section === "required") {
    return { priority: "REQUIRED", isGate: false };
  }
  if (section === "responsibility" || RESPONSIBILITY_RE.test(evidence)) {
    return { priority: "CORE", isGate: false };
  }
  return { priority: "MENTIONED", isGate: false };
}

/**
 * Extract and rank JD technologies without an LLM. Section headings and local
 * requirement language decide priority. Benefits/company narrative is ignored,
 * preventing tool-name decoration from diluting actual must-have coverage.
 */
export function analyzeJobTechnicalRequirements(
  description: string | null | undefined,
): TechnicalRequirement[] {
  if (!description?.trim()) return [];

  const normalized = description
    .replace(/<(?:br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "");
  const lines = normalized.split(/\n+/);
  const requirements = new Map<string, TechnicalRequirement & { order: number }>();
  let section: SectionKind = "neutral";
  let order = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[\s>*+-]+/, "").trim();
    if (!line) continue;
    const heading = parseHeading(line);
    if (heading) {
      section = heading.kind;
      if (!heading.remainder) continue;
    }
    const content = heading?.remainder || line;

    for (const evidence of splitEvidence(content)) {
      const mentions = extractSkillMentions(evidence);
      if (!mentions.length) continue;
      const hardOverride = REQUIREMENT_LANGUAGE_RE.test(evidence);
      if (section === "ignored" && !hardOverride) continue;
      const classification = classifyPriority(evidence, section);

      for (const mention of mentions) {
        const existing = requirements.get(mention.name);
        const aliases = existing
          ? Array.from(new Set([...existing.aliases, mention.alias]))
          : [mention.alias];
        const stronger =
          !existing ||
          classification.isGate ||
          PRIORITY_RANK[classification.priority] >
            PRIORITY_RANK[existing.priority];
        requirements.set(mention.name, {
          skill: mention.name,
          priority: stronger ? classification.priority : existing.priority,
          isGate: Boolean(existing?.isGate || classification.isGate),
          evidence: stronger ? evidence.slice(0, 240) : existing.evidence,
          aliases,
          order: existing?.order ?? order++,
        });
      }
    }
  }

  return [...requirements.values()]
    .sort((a, b) => {
      if (a.isGate !== b.isGate) return a.isGate ? -1 : 1;
      const rankDelta = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      return rankDelta || a.order - b.order;
    })
    .map(({ order: _order, ...requirement }) => requirement);
}

function splitStructuralEvidence(value: string): string[] {
  return value
    .split(/\s*(?:;|\u2022|\.(?=\s+[A-Z0-9]))\s*/)
    .map((part) => part.replace(/^[\s>*+-]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Extract explicit non-technical barriers from the complete JD. This payload
 * survives lean prompt truncation; soft, negated, and sponsorship-offered
 * statements are deliberately excluded.
 */
export function analyzeJobStructuralGates(
  description: string | null | undefined,
): StructuralGateSignal[] {
  if (!description?.trim()) return [];

  const normalized = description
    .replace(/<(?:br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "");
  const signals: StructuralGateSignal[] = [];
  const seen = new Set<string>();
  let section: SectionKind = "neutral";

  const emit = (
    kind: StructuralGateKind,
    requirement: string,
    evidence: string,
  ) => {
    const conciseEvidence = evidence.slice(0, 240);
    const key = `${kind}\u0000${conciseEvidence.toLocaleLowerCase("en")}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push({ kind, requirement, evidence: conciseEvidence });
  };

  for (const rawLine of normalized.split(/\n+/)) {
    const line = rawLine.replace(/^[\s>*+-]+/, "").trim();
    if (!line) continue;
    const heading = parseHeading(line);
    if (heading) {
      section = heading.kind;
      if (!heading.remainder) continue;
    }
    const content = heading?.remainder || line;

    for (const evidence of splitStructuralEvidence(content)) {
      if (
        SOFT_REQUIREMENT_RE.test(evidence) ||
        STRUCTURAL_NEGATION_RE.test(evidence)
      ) {
        continue;
      }

      const explicitHard = REQUIREMENT_LANGUAGE_RE.test(evidence);
      const requirementSection = section === "gate" || section === "required";
      const hard = explicitHard || requirementSection;

      if (
        WORK_RIGHTS_RE.test(evidence) &&
        !SPONSORSHIP_AVAILABLE_RE.test(evidence) &&
        (hard || WORK_RIGHTS_INTRINSIC_RE.test(evidence))
      ) {
        emit("WORK_RIGHTS", "Work rights or visa eligibility", evidence);
      }
      if (CLEARANCE_RE.test(evidence) && hard) {
        emit("CLEARANCE", "Security clearance", evidence);
      }
      if (LICENCE_RE.test(evidence) && hard) {
        emit("LICENCE", "Required licence", evidence);
      }
      if (
        LOCATION_RE.test(evidence) &&
        (hard || LOCATION_INTRINSIC_RE.test(evidence))
      ) {
        emit("LOCATION", "Mandatory work location", evidence);
      }

      const years = evidence.match(YEARS_RE);
      if (
        years &&
        (EXPERIENCE_CONTEXT_RE.test(evidence) || explicitHard) &&
        (hard ||
          /\b(?:you(?:'ve| have| bring)|proven|demonstrated)\b/i.test(evidence))
      ) {
        emit("EXPERIENCE", `${years[0]} experience`, evidence);
      }
    }
  }

  return signals.slice(0, 10);
}
