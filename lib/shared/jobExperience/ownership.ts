import type { HeadingContext, YearExpression } from "./types";

export type InternalClassification =
  "REQUIRED" | "STATED" | "PREFERRED" | "ALTERNATIVE" | "REVIEW";

export type ExpressionAssessment = {
  classification: InternalClassification;
  explicitClassification: "REQUIRED" | "PREFERRED" | null;
  scope: string | null;
  propagationEligible: boolean;
};

const DIRECT_EXPERIENCE_RE =
  /\b(?:years?|yrs?\.?|yr\.?|y|months?|mos?\.?|mo\.?|mths?\.?|m)['\u2019]?\s+(?:of\s+)?(?:[a-z0-9+#./-]+\s+){0,8}(?:experience|exp|track\s+record)\b|\b(?:experience|exp|track\s+record)\b.{0,65}\b(?:years?|yrs?|months?|mos?)\b/iu;
const HARD_SIGNAL_RE =
  /\b(?:required|requires?|must(?:\s+have)?|mandatory|essential|minimum|at\s+least|need(?:ed|s)?|qualification|no\s+(?:fewer|less)\s+than)\b|(?:>=|\u2265)/giu;
const PREFERRED_SIGNAL_RE =
  /\b(?:prefer(?:red)?|desirable|desired|ideally|nice[- ]to[- ]have|bonus|optional|a\s+plus|advantageous)\b/giu;
const NEGATED_EXPERIENCE_RE =
  /\b(?:do|does|did)\s+not\s+(?:need|require)\b|\b(?:experience|background)\b.{0,60}\bnot\s+(?:required|necessary|essential|mandatory)\b|\bno\b(?!\s+(?:fewer|less|more)\b).{0,90}\b(?:required|necessary|needed|mandatory)\b/iu;
const NON_ROLE_NOUN_RE =
  /\b(?:availability|commitment|contract|engagement|assignment|roadmap|timeline|horizon|runway|visa|passport|degree|diploma|university|college|study|course|training|programme|program|apprenticeship|internship|warranty|licen[cs]e|registration|membership|clearance|certificate|certification|residen(?:ce|cy)|citizenship|work\s+rights?|sponsorship|retention|audit|funding|service)\b/iu;
const CANDIDATE_SUBJECT_RE =
  /\b(?:you|your|applicants?|candidates?|successful\s+applicant|ideal\s+candidate|we\s+(?:seek|need|require|are\s+looking\s+for))\b/giu;
const OTHER_OWNER_RE =
  /\b(?:company|business|organisation|organization|firm|team|founders?|co[- ]?founders?|customers?|clients?|manager|leader|director|supervisor|executives?|colleagues?|consultants?|partners?)\b/giu;

function nearestMatchIndex(value: string, regex: RegExp): number {
  let last = -1;
  for (const match of value.matchAll(regex)) last = match.index;
  return last;
}

function qualifierDistance(
  value: string,
  regex: RegExp,
  expression: YearExpression,
): number | null {
  const center = (expression.start + expression.end) / 2;
  let nearest: number | null = null;
  for (const match of value.matchAll(regex)) {
    const distance = Math.abs(match.index + match[0].length / 2 - center);
    nearest = nearest === null ? distance : Math.min(nearest, distance);
  }
  return nearest;
}

function explicitClassification(
  evidence: string,
  expression: YearExpression,
): "REQUIRED" | "PREFERRED" | null {
  const preferred = qualifierDistance(
    evidence,
    new RegExp(PREFERRED_SIGNAL_RE.source, "giu"),
    expression,
  );
  const required = qualifierDistance(
    evidence,
    new RegExp(HARD_SIGNAL_RE.source, "giu"),
    expression,
  );
  if (preferred === null && required === null) return null;
  if (preferred === null) return "REQUIRED";
  if (required === null) return "PREFERRED";
  return preferred <= required ? "PREFERRED" : "REQUIRED";
}

function isRecencyWindow(
  evidence: string,
  expression: YearExpression,
): boolean {
  const before = evidence.slice(
    Math.max(0, expression.start - 70),
    expression.start,
  );
  const after = evidence.slice(
    expression.end,
    Math.min(evidence.length, expression.end + 35),
  );
  return (
    /\b(?:within|during|in|over|throughout)\s+(?:the\s+)?(?:last|past|previous|preceding|recent)\s*$/iu.test(
      before,
    ) ||
    /\b(?:last|past|previous|preceding|recent)\s*$/iu.test(before) ||
    /^\s*(?:ago|window|period)\b/iu.test(after)
  );
}

function isEducationAlternative(
  evidence: string,
  expression: YearExpression,
): boolean {
  const education =
    "(?:bachelor(?:'s|\u2019s)?|master(?:'s|\u2019s)?|doctoral|university|college|tertiary|formal\\s+education|qualification|degree|diploma)";
  const before = evidence.slice(0, expression.start);
  const after = evidence.slice(expression.end);
  return (
    new RegExp(`\\b${education}\\b[^.;]{0,120}\\bor\\s*$`, "iu").test(before) ||
    new RegExp(`^.{0,100}\\bor\\b[^.;]{0,120}\\b${education}\\b`, "iu").test(
      after,
    ) ||
    new RegExp(
      `\\b(?:in\\s+lieu\\s+of|instead\\s+of|in\\s+place\\s+of|as\\s+(?:an\\s+)?alternative\\s+to)\\b[^.;]{0,100}\\b${education}\\b`,
      "iu",
    ).test(after)
  );
}

function ownedBySomeoneElse(
  evidence: string,
  expression: YearExpression,
): boolean {
  const before = evidence.slice(0, expression.start);
  const candidate = nearestMatchIndex(
    before,
    new RegExp(CANDIDATE_SUBJECT_RE.source, "giu"),
  );
  const other = nearestMatchIndex(
    before,
    new RegExp(OTHER_OWNER_RE.source, "giu"),
  );
  const localAfter = evidence.slice(expression.end, expression.end + 100);
  if (
    /\b(?:held|possessed|brought|provided)\s+by\s+(?:the\s+|our\s+)?(?:manager|leader|director|team|founder|client|customer)\b/iu.test(
      localAfter,
    )
  ) {
    return true;
  }
  if (other <= candidate) return false;
  const ownerTail = before.slice(other);
  return /\b(?:has|have|had|brings?|offers?|with|combined|collective|founded|led\s+by|managed\s+by|requires?|needs?|must|seeks?|expects?|demands?)\b/iu.test(
    ownerTail,
  );
}

function isLocationOrAvailabilityTenure(
  evidence: string,
  expression: YearExpression,
): boolean {
  const before = evidence.slice(
    Math.max(0, expression.start - 110),
    expression.start,
  );
  const after = evidence.slice(
    expression.end,
    Math.min(evidence.length, expression.end + 70),
  );

  // Bind the duration to its semantic owner. Merely mentioning that an
  // applicant must be based in Sydney elsewhere in the same requirements
  // sentence must not suppress a later professional-experience requirement.
  return (
    /\b(?:available|able\s+to\s+work|authori[sz]ed\s+to\s+work|remain\s+valid|lived|resided|resident|based|located)\b[^.;]{0,80}\b(?:for|during|over|throughout)\s+(?:(?:an?|the)\s+)?(?:(?:next|following)\s+)?$/iu.test(
      before,
    ) ||
    /^\s+(?:being\s+)?(?:available|based|located|living|residing)\b/iu.test(
      after,
    )
  );
}

function nonRoleDuration(
  evidence: string,
  expression: YearExpression,
): boolean {
  if (isRecencyWindow(evidence, expression)) return true;
  const vicinity = evidence.slice(
    Math.max(0, expression.start - 45),
    Math.min(evidence.length, expression.end + 105),
  );
  if (/\byears?\s+(?:old|ago|of\s+service)\b/iu.test(vicinity)) return true;
  if (isLocationOrAvailabilityTenure(evidence, expression)) {
    return true;
  }
  if (!NON_ROLE_NOUN_RE.test(vicinity)) return false;
  // A sentence can mention a contract and a genuine experience requirement.
  // Judge only the immediate expression vicinity, not the whole sentence.
  return !DIRECT_EXPERIENCE_RE.test(vicinity);
}

function hasCandidateContext(
  evidence: string,
  expression: YearExpression,
  heading: HeadingContext,
  candidateLabel: boolean,
): boolean {
  if (candidateLabel) return true;
  if (ownedBySomeoneElse(evidence, expression)) return false;
  const vicinity = evidence.slice(
    Math.max(0, expression.start - 90),
    Math.min(evidence.length, expression.end + 120),
  );
  if (DIRECT_EXPERIENCE_RE.test(vicinity)) return true;
  const tail = evidence.slice(expression.end);
  if (
    /^['\u2019]?\s+(?:in|with|using|on|as|working\s+(?:in|with|as))\b/iu.test(
      tail,
    )
  ) {
    return true;
  }
  if (bareScope(evidence, expression)) return true;
  const before = evidence.slice(0, expression.start);
  return (
    new RegExp(CANDIDATE_SUBJECT_RE.source, "iu").test(before) &&
    (heading !== null || explicitClassification(evidence, expression) !== null)
  );
}

function cleanScope(value: string | undefined): string | null {
  const scope = (value ?? "")
    .replace(
      /^(?:of\s+)?(?:experience|track\s+record)\s+(?:in|within|across|with|using|on)\s+/iu,
      "",
    )
    .replace(
      /^(?:as\s+(?:an?\s+)?|working\s+(?:in|within|across|with|as)\s+)/iu,
      "",
    )
    .replace(
      /\s+(?:within|during|in|over)\s+(?:the\s+)?(?:last|past|previous|preceding|recent)\s+\d+(?:\.\d+)?\s+(?:years?|months?).*$/iu,
      "",
    )
    .replace(
      /\s+(?:is\s+|are\s+)?(?:required|preferred|mandatory|essential|desired)\b.*$/iu,
      "",
    )
    .trim()
    .replace(/^[,:\-\s]+|[,:\-\s]+$/gu, "")
    .replace(/\s+(?:experience|exp|track\s+record)\.?$/iu, "")
    .replace(/\s+/g, " ");
  if (!scope || scope.length > 160 || scope.split(/\s+/).length > 14) {
    return null;
  }
  if (
    /^(?:of|(?:of\s+)?experience|professional|commercial|relevant|hands-on|industry|general|overall|work|total|duration|term|period|is|are|was|were|has|have|required|preferred)$/iu.test(
      scope,
    )
  ) {
    return null;
  }
  return scope;
}

function bareScope(
  evidence: string,
  expression: YearExpression,
): string | null {
  const tail = evidence
    .slice(expression.end)
    .replace(
      /\b(?:if|unless|provided(?:\s+that)?|depending(?:\s+on)?)\b.*$/iu,
      "",
    );
  const match = tail.match(
    /^['\u2019]?\s+([.A-Za-z0-9+#/-]+(?:\s+[.A-Za-z0-9+#/-]+){0,7})(?:\s+(?:is\s+)?(?:required|preferred|mandatory|essential|desired))?\s*$/iu,
  );
  const scope = cleanScope(match?.[1]);
  if (
    scope &&
    !/^(?:for|during|until|within|after|before|per|throughout|ago|old|service|contract|visa|degree|course|training|programme|program)\b/iu.test(
      scope,
    )
  ) {
    return scope;
  }
  return null;
}

export function scopeForExpression(
  clause: string,
  expression: YearExpression,
): string | null {
  const tail = clause.slice(expression.end).replace(/^['\u2019]?\s*/, "");
  const generic = tail.match(
    /^(?:of\s+)?(?:(?:professional|commercial|relevant|hands-on|industry)\s+)?(?:experience|track\s+record)\s+(?:in|within|across|with|using|on)\s+(.+)$/iu,
  );
  if (generic) return cleanScope(generic[1]);
  const scoped = tail.match(/^of\s+(.+?)\s+(?:experience|track\s+record)\b/iu);
  if (scoped) return cleanScope(scoped[1]);
  const direct = tail.match(
    /^(?:(?:in|within|across|with|using|on)\s+|as\s+(?:an?\s+)?|working\s+(?:in|within|across|with|as)\s+)(.+)$/iu,
  );
  if (direct) return cleanScope(direct[1]);
  const bare = bareScope(clause, expression);
  if (bare) return bare;

  const prefix = clause.slice(0, expression.start);
  const leading = prefix.match(
    /\b(?:experience|track\s+record)\s+(?:in|within|across|with|using|on)\s+([^:;]{1,120})\s*:\s*$/iu,
  );
  if (leading) return cleanScope(leading[1]);
  const prefixExperience = prefix.match(
    /([.A-Za-z0-9][.A-Za-z0-9+#/ -]{0,120}?)\s+(?:experience|track\s+record)\s*:?\s*$/iu,
  );
  return cleanScope(prefixExperience?.[1]);
}

/** Apply candidate ownership and strength semantics to one lexical match. */
export function assessExpression(
  evidence: string,
  expression: YearExpression,
  heading: HeadingContext,
  candidateLabel = false,
): ExpressionAssessment | null {
  if (isSuppressedExpression(evidence, expression)) return null;
  if (!hasCandidateContext(evidence, expression, heading, candidateLabel)) {
    return null;
  }

  const explicit = explicitClassification(evidence, expression);
  let classification: InternalClassification;
  if (expression.ambiguous) classification = "REVIEW";
  else if (isEducationAlternative(evidence, expression)) {
    classification = "ALTERNATIVE";
  } else if (explicit) classification = explicit;
  else if (heading) classification = heading;
  // Isolated quantified experience is real evidence, but without a hard
  // signal it must not become a visible requirement.
  else classification = "REVIEW";

  return {
    classification,
    explicitClassification: explicit,
    scope: scopeForExpression(evidence, expression),
    propagationEligible:
      !expression.ambiguous &&
      explicit === null &&
      heading === null &&
      classification === "REVIEW",
  };
}

/** Suppress durations that cannot belong to an applicant requirement. */
export function isSuppressedExpression(
  evidence: string,
  expression: YearExpression,
): boolean {
  return (
    nonRoleDuration(evidence, expression) ||
    (NEGATED_EXPERIENCE_RE.test(evidence) &&
      !new RegExp(PREFERRED_SIGNAL_RE.source, "iu").test(evidence)) ||
    ownedBySomeoneElse(evidence, expression)
  );
}
