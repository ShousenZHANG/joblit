const RESPONSIBILITY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "our",
  "their",
  "you",
  "will",
  "have",
  "has",
  "are",
  "is",
  "to",
  "of",
  "in",
  "on",
  "as",
  "by",
  "an",
  "a",
  "be",
  "or",
  "at",
  "across",
  "using",
  "through",
  "experience",
  "experienced",
  "strong",
  "ability",
  "abilities",
  "knowledge",
  "understanding",
  "familiarity",
  "support",
  "supporting",
  "work",
  "working",
  "team",
  "teams",
  "stakeholders",
  "candidate",
  "role",
  "responsibility",
  "responsibilities",
  "required",
  "preferred",
  "must",
  "should",
  "would",
]);

type SectionKind = "responsibility" | "requirement" | "narrative" | "neutral";

const RESPONSIBILITY_HEADER_TOKENS = [
  "responsibilities",
  "responsibility",
  "your responsibilities",
  "key responsibilities",
  "key duties",
  "what you'll do",
  "what you will do",
  "what you'll be doing",
  "what you will be doing",
  "what you'll be working on",
  "what you will be working on",
  "what you could work on",
  "what you can work on",
  "what you'll own",
  "what you will own",
  "in this role",
] as const;

const REQUIREMENT_HEADER_TOKENS = [
  "requirements",
  "qualifications",
  "what you'll bring",
  "what you will bring",
  "what you bring",
  "what you offer",
  "required skills",
  "must have",
  "nice to have",
  "to be successful in this role",
  "your profile",
  "job profile",
  "about you",
  "who you are",
] as const;

const NARRATIVE_HEADER_TOKENS = [
  "about us",
  "about the company",
  "about aircall",
  "who we are",
  "company overview",
  "benefits",
  "culture",
  "our mission",
  "why join",
] as const;

const BULLET_PREFIX_RE = /^\s*(?:[-*]|[\u2022\u25CF\u25AA\u25E6\u2023]|\d+[.)]|[a-zA-Z][.)])\s+/;
const ACTION_VERB_RE =
  /\b(build|design|develop|implement|integrat|automate|architect|deploy|operationaliz|lead|own|maintain|improv|optimi[sz]e|collaborat|monitor|troubleshoot|mentor|deliver|translate|execute|drive|shape|manage|coordinate|partner|analy[sz]e|review|test|document|ship)\b/i;
const TASK_OBJECT_RE =
  /\b(api|apis|workflow|workflows|integration|integrations|platform|platforms|system|systems|pipeline|pipelines|deployment|deployments|incident|incidents|monitoring|observability|solution|solutions|automation|process|processes|delivery|rollout|crm|crms|help[\s-]?desk|ticketing|customer|customers|project|projects)\b/i;
const TECH_SIGNAL_RE =
  /\b(java|python|javascript|typescript|react|node|sql|postgres|aws|azure|gcp|docker|kubernetes|terraform|graphql|rest|oauth|github actions|ci\/cd|llm|ai)\b/i;
const REQUIREMENT_SIGNAL_RE = /\b(must|required|requirement|expected to|you'll|you will)\b/i;
const NARRATIVE_PHRASE_RE =
  /\b(unicorn|headquartered|offices|worldwide|investors|funding|mission|customer-obsessed|company in motion|strong presence|backed by|our momentum)\b/i;

type Candidate = {
  text: string;
  index: number;
  section: SectionKind;
  score: number;
};

function normalizeTextForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s+/#.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeadingText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^a-z0-9\s'()/&:+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAnyToken(text: string, tokens: readonly string[]) {
  return tokens.some((token) => text.includes(token));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLine(line: string) {
  return line.replace(BULLET_PREFIX_RE, "").trim();
}

function detectSectionHeader(line: string): SectionKind | null {
  const cleaned = line.replace(/:+$/, "").trim();
  if (!cleaned) return null;

  const looksLikeHeader =
    line.endsWith(":") ||
    cleaned.length <= 80 ||
    /^[A-Z][A-Za-z\s'()/&-]+$/.test(cleaned);
  if (!looksLikeHeader) return null;

  const normalized = normalizeHeadingText(cleaned);
  if (matchesAnyToken(normalized, NARRATIVE_HEADER_TOKENS)) return "narrative";
  if (matchesAnyToken(normalized, RESPONSIBILITY_HEADER_TOKENS)) return "responsibility";
  if (matchesAnyToken(normalized, REQUIREMENT_HEADER_TOKENS)) return "requirement";
  return null;
}

function hasNarrativeSignals(text: string) {
  return NARRATIVE_PHRASE_RE.test(text);
}

function looksLikeResponsibility(
  line: string,
  section: SectionKind,
  isBullet: boolean,
) {
  if (!line || line.length < 18 || line.length > 260) return false;
  if (line.endsWith(":")) return false;
  if (section === "narrative") return false;
  if (hasNarrativeSignals(line)) return false;

  const hasAction = ACTION_VERB_RE.test(line);
  const hasTaskObject = TASK_OBJECT_RE.test(line);
  const hasTechSignal = TECH_SIGNAL_RE.test(line);
  const requirementSignal = REQUIREMENT_SIGNAL_RE.test(line);

  if (!hasAction && section !== "requirement") return false;

  if (section === "responsibility") {
    return hasTaskObject || isBullet || requirementSignal;
  }
  if (section === "requirement") {
    return (hasTaskObject || hasTechSignal) && (hasAction || isBullet || requirementSignal);
  }
  return isBullet && hasTaskObject;
}

function scoreCandidate(
  line: string,
  section: SectionKind,
  isBullet: boolean,
) {
  const sectionWeight =
    section === "responsibility" ? 1 : section === "requirement" ? 0.68 : section === "neutral" ? 0.35 : 0;
  const actionHits = (line.match(new RegExp(ACTION_VERB_RE.source, "gi")) ?? []).length;
  const taskHits = (line.match(new RegExp(TASK_OBJECT_RE.source, "gi")) ?? []).length;
  const techHits = (line.match(new RegExp(TECH_SIGNAL_RE.source, "gi")) ?? []).length;
  const requirementSignal = REQUIREMENT_SIGNAL_RE.test(line) ? 1 : 0;
  const narrativePenalty = hasNarrativeSignals(line) ? 0.75 : 0;
  const lengthPenalty = line.length > 220 ? 0.1 : 0;

  return (
    sectionWeight +
    (isBullet ? 0.2 : 0) +
    Math.min(actionHits * 0.06, 0.18) +
    Math.min(taskHits * 0.05, 0.15) +
    Math.min(techHits * 0.04, 0.12) +
    requirementSignal * 0.05 -
    narrativePenalty -
    lengthPenalty
  );
}

function dedupeRanked(items: Candidate[]) {
  const best = new Map<string, Candidate>();
  for (const item of items) {
    const key = normalizeTextForMatch(item.text);
    if (!key) continue;
    const existing = best.get(key);
    if (!existing || item.score > existing.score) {
      best.set(key, item);
    }
  }
  return Array.from(best.values()).sort((a, b) => {
    if (b.score === a.score) return a.index - b.index;
    return b.score - a.score;
  });
}

function parseLineCandidates(lines: string[]) {
  const candidates: Candidate[] = [];
  let section: SectionKind = "neutral";

  lines.forEach((raw, index) => {
    const header = detectSectionHeader(raw);
    if (header) {
      section = header;
      return;
    }
    const isBullet = BULLET_PREFIX_RE.test(raw);
    const cleaned = cleanLine(raw);
    if (!cleaned) return;
    if (!looksLikeResponsibility(cleaned, section, isBullet)) return;

    candidates.push({
      text: cleaned,
      index,
      section,
      score: scoreCandidate(cleaned, section, isBullet),
    });
  });

  return candidates;
}

function parseSentenceCandidates(text: string) {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return sentences
    .map((sentence, index) => {
      if (!looksLikeResponsibility(sentence, "neutral", true)) return null;
      return {
        text: sentence,
        index,
        section: "neutral" as const,
        score: scoreCandidate(sentence, "neutral", true),
      };
    })
    .filter((item) => item !== null) as Candidate[];
}

function extractResponsibilities(
  description: string | null | undefined,
  limit = 8,
) {
  const text = (description ?? "").trim();
  if (!text) return [] as string[];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lineCandidates = parseLineCandidates(lines);
  const ranked =
    lineCandidates.length > 0
      ? dedupeRanked(lineCandidates)
      : dedupeRanked(parseSentenceCandidates(text));

  return ranked
    .filter((item) => item.score >= 0.4)
    .slice(0, limit)
    .map((item) => item.text);
}

export function extractTopResponsibilities(description: string | null | undefined) {
  return extractResponsibilities(description, 3);
}

function extractResponsibilityKeywords(line: string) {
  return Array.from(
    new Set(
      normalizeTextForMatch(line)
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 4 && !RESPONSIBILITY_STOPWORDS.has(token)),
    ),
  );
}

function bulletMatchesResponsibility(bullet: string, responsibility: string) {
  const bulletNorm = normalizeTextForMatch(bullet);
  const keywords = extractResponsibilityKeywords(responsibility);
  if (keywords.length === 0) return false;

  let hits = 0;
  for (const kw of keywords) {
    const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
    if (re.test(bulletNorm)) hits += 1;
  }
  const hitRatio = hits / keywords.length;
  const minHits = keywords.length >= 6 ? 3 : 2;
  return hits >= minHits && hitRatio >= 0.34;
}

export function computeTop3Coverage(description: string | null | undefined, baseBullets: string[]) {
  const allResponsibilities = extractResponsibilities(description, 10);
  const topResponsibilities = allResponsibilities.slice(0, 3);
  const missingFromBase = topResponsibilities.filter(
    (resp) => !baseBullets.some((bullet) => bulletMatchesResponsibility(bullet, resp)),
  );
  const fallbackResponsibilities =
    missingFromBase.length > 0
      ? allResponsibilities
          .slice(3)
          .filter((resp) => !baseBullets.some((bullet) => bulletMatchesResponsibility(bullet, resp)))
      : [];

  if (missingFromBase.length === 0) {
    return {
      topResponsibilities,
      missingFromBase,
      fallbackResponsibilities: [],
      requiredNewBulletsMin: 0,
      requiredNewBulletsMax: 0,
    };
  }

  return {
    topResponsibilities,
    missingFromBase,
    fallbackResponsibilities,
    requiredNewBulletsMin: Math.min(Math.max(2, missingFromBase.length), 3),
    requiredNewBulletsMax: 3,
  };
}
