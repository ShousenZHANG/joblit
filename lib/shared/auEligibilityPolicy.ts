import { AU_RECALL_SAFE_V1_POLICY_ID } from "./fetchPolicy";

export const AU_ELIGIBILITY_POLICY_VERSION = AU_RECALL_SAFE_V1_POLICY_ID;

export type AuEligibilityReasonCode =
  | "AU_CITIZEN_REQUIRED"
  | "AU_PR_REQUIRED"
  | "AU_BASELINE_REQUIRED"
  | "AU_NV1_REQUIRED"
  | "AU_NV2_REQUIRED"
  | "AU_GOV_CLEARANCE_REQUIRED"
  | "AU_CLEARANCE_OBTAIN_REQUIRED";

export type AuEligibilityEvidence = {
  clause: string;
  start: number;
  end: number;
};

export type AuEligibilityDecision = {
  verdict: "EXCLUDE" | "KEEP";
  policyVersion: typeof AU_ELIGIBILITY_POLICY_VERSION;
  confidence: "EXPLICIT" | "NONE";
  reasonCode?: AuEligibilityReasonCode;
  evidence?: AuEligibilityEvidence;
};

export type AuEligibilityPolicyOptions = {
  identityRequirement?: boolean;
  clearanceRequirement?: boolean;
};

type Clause = AuEligibilityEvidence & { normalized: string };

const CLAUSE_BOUNDARY_RE =
  /(?:[.;!?]+|\r?\n+|[•●▪]+|<\s*br\s*\/?>|<\/(?:li|p)>|\s+\b(?:but|however|whereas|although)\b\s+)/giu;

const AU_CITIZEN_TARGET = String.raw`(?:australian\s+citizen(?:s|ship)?(?:\s+status)?|citizen(?:s|ship)?(?:\s+or\s+(?:australian\s+)?pr)?\s+of\s+australia(?:\s+or\s+(?:new\s+zealand|nz))?)`;
const AU_PR_TARGET = String.raw`(?:australian\s+permanent\s+residen(?:t|ts|ce|cy)|permanent\s+residen(?:t|ts|ce|cy)\s+(?:of|in)\s+australia|(?:australian|au|aus)\s+pr(?:\s+(?:holder|status))?|pr\s+(?:holder|status)\s+(?:of|in)\s+australia)`;
const AU_PR_CONJUNCT_TARGET = String.raw`(?:(?:australian\s+)?permanent\s+residen(?:t|ts|ce|cy)|(?:australian|au|aus)\s+pr(?:\s+(?:holder|status))?)`;
const AU_CITIZEN_OR_PR_TARGET = String.raw`(?:${AU_CITIZEN_TARGET})(?:\s*(?:(?:\/|,)\s*|(?:and|or)\s+)(?:an?\s+)?${AU_PR_CONJUNCT_TARGET})?`;
const AU_PR_OR_CITIZEN_TARGET = String.raw`(?:${AU_PR_TARGET})(?:\s*(?:(?:\/|,)\s*|(?:and|or)\s+)(?:an?\s+)?${AU_CITIZEN_TARGET})?`;

const BASELINE_TARGET = String.raw`(?:agsva\s+baseline(?:\s+(?:security\s+)?clearance)?|baseline\s+(?:security\s+)?clearance)`;
const NV1_TARGET = String.raw`(?:nv[\s-]?1|negative\s+vetting\s+1)(?:\s+(?:security\s+)?clearance)?`;
const NV2_TARGET = String.raw`(?:nv[\s-]?2|negative\s+vetting\s+2)(?:\s+(?:security\s+)?clearance)?`;
const GOVERNMENT_CLEARANCE_TARGET = String.raw`(?:australian\s+government|agsva)(?:\s+security)?\s+clearance`;
const ANY_AU_CLEARANCE_TARGET = String.raw`(?:${BASELINE_TARGET}|${NV1_TARGET}|${NV2_TARGET}|${GOVERNMENT_CLEARANCE_TARGET})`;

const CANDIDATE_SUBJECT = String.raw`(?:applicants?|candidates?|successful\s+applicants?|successful\s+candidates?|the\s+successful\s+(?:applicant|candidate)|you)`;
const DIRECT_HOLD_VERB = String.raw`(?:be|hold|have|possess|maintain)`;
const HARD_POSTFIX = String.raw`(?:required|mandatory|essential|a\s+(?:(?:mandatory|strict|minimum)\s+)?(?:condition\s+of\s+employment|prerequisite|requirement(?:\s+of\s+(?:this|the)\s+(?:role|position|job))?))`;
const TARGET_PREFIX = String.raw`(?:either\s+)?(?:an?\s+)?(?:active\s+|current\s+|existing\s+)?`;
const ALL_EXPLICIT_GATE_TARGET = String.raw`(?:${AU_CITIZEN_OR_PR_TARGET}|${AU_PR_OR_CITIZEN_TARGET}|${ANY_AU_CLEARANCE_TARGET})`;
const KNOWN_GATE_VALUE = String.raw`${TARGET_PREFIX}(?:${ALL_EXPLICIT_GATE_TARGET})\b`;
const GATE_CONJUNCTION_TAIL = String.raw`(?:\s*(?:(?:\/|,)\s*|(?:and|or)\s+)(?:(?:be|hold|have|possess|maintain)\s+)?${KNOWN_GATE_VALUE})*`;
const GATE_QUALIFIER_TAIL = String.raw`(?:\s+(?:for\s+(?:(?:this|the)\s+(?:role|position|job)|appointment|employment)|to\s+(?:apply|be\s+considered|qualify|commence)|at\s+(?:the\s+)?(?:time\s+of\s+)?(?:application|appointment|commencement)|(?:prior\s+to|before|on)\s+(?:appointment|commencement|starting)|throughout\s+(?:employment|the\s+(?:role|position|job))|as\s+a\s+condition\s+of\s+employment))?`;
const CLOSED_GATE_END = String.raw`${GATE_CONJUNCTION_TAIL}${GATE_QUALIFIER_TAIL}\s*$`;
const POSTFIX_END = String.raw`${GATE_QUALIFIER_TAIL}\s*$`;

function exact(pattern: string): RegExp {
  return new RegExp(pattern, "iu");
}

function requiredTargetPatterns(target: string): readonly RegExp[] {
  const value = String.raw`${TARGET_PREFIX}(?:${target})\b`;
  return [
    exact(
      String.raw`\b${CANDIDATE_SUBJECT}\s+(?:(?:must|need(?:s)?\s+to|will\s+need\s+to)\s+${DIRECT_HOLD_VERB}|(?:is|are|will\s+be)\s+required\s+to\s+${DIRECT_HOLD_VERB})\s+${value}${CLOSED_GATE_END}`,
    ),
    exact(
      String.raw`^(?:must|need\s+to|required\s+to|will\s+need\s+to)\s+${DIRECT_HOLD_VERB}\s+${value}${CLOSED_GATE_END}`,
    ),
    exact(String.raw`\b${CANDIDATE_SUBJECT}\s+(?:need(?:s)?|require(?:s)?)\s+${value}${CLOSED_GATE_END}`),
    exact(String.raw`^requires?\s+${value}${CLOSED_GATE_END}`),
    exact(
      String.raw`\b(?:this\s+)?(?:role|position|job)\s+requires?\s+${value}${CLOSED_GATE_END}`,
    ),
    exact(
      String.raw`^(?:eligibility|mandatory|required|essential)(?:\s+(?:criteria|requirements?))?\s*:\s*${value}${CLOSED_GATE_END}`,
    ),
    exact(String.raw`^${value}${GATE_CONJUNCTION_TAIL}\s+(?:is|are)\s+${HARD_POSTFIX}\b${POSTFIX_END}`),
    exact(String.raw`^${value}${GATE_CONJUNCTION_TAIL}\s+${HARD_POSTFIX}\b${POSTFIX_END}`),
    exact(
      String.raw`^${value}${GATE_CONJUNCTION_TAIL}\s+only(?:\s+(?:may|can)\s+apply)?$`,
    ),
    exact(
      String.raw`\bonly\s+${value}${GATE_CONJUNCTION_TAIL}\s+(?:(?:may|can|will)\s+(?:apply|be\s+considered|be\s+eligible)|(?:is|are)\s+eligible\s+to\s+apply)$`,
    ),
    exact(
      String.raw`\b(?:restricted|limited|only\s+open|only\s+available|open\s+only|available\s+only)\s+to\s+${value}${CLOSED_GATE_END}`,
    ),
    exact(String.raw`^(?:open|available)\s+to\s+${value}${GATE_CONJUNCTION_TAIL}\s+only$`),
    exact(
      String.raw`^only\s+(?:applicants?|candidates?)\s+who\s+(?:are|hold|have|possess)\s+${value}${GATE_CONJUNCTION_TAIL}\s+(?:may|can|will)\s+(?:apply|be\s+considered|be\s+eligible)$`,
    ),
    exact(String.raw`^(?:applications?|applicants?)\s+from\s+${value}${GATE_CONJUNCTION_TAIL}\s+only$`),
    exact(
      String.raw`\b${CANDIDATE_SUBJECT}\b[^,]{0,50}\b(?:cannot|will\s+not|won't)\s+be\s+considered\s+without\s+${value}${CLOSED_GATE_END}`,
    ),
  ];
}

const CITIZEN_REQUIRED_RE = requiredTargetPatterns(AU_CITIZEN_OR_PR_TARGET);
const PR_REQUIRED_RE = requiredTargetPatterns(AU_PR_OR_CITIZEN_TARGET);
const BASELINE_REQUIRED_RE = requiredTargetPatterns(BASELINE_TARGET);
const NV1_REQUIRED_RE = requiredTargetPatterns(NV1_TARGET);
const NV2_REQUIRED_RE = requiredTargetPatterns(NV2_TARGET);
const GOVERNMENT_CLEARANCE_REQUIRED_RE = requiredTargetPatterns(
  GOVERNMENT_CLEARANCE_TARGET,
);
const INVERSE_CITIZEN_REQUIREMENT_RE = exact(
  String.raw`^(?:citizenship|citizen)\s+requirement\s*:\s*australian$`,
);

const CLEARANCE_VALUE = String.raw`${TARGET_PREFIX}(?:${ANY_AU_CLEARANCE_TARGET})\b`;
const CLEARANCE_ACQUISITION = String.raw`obtain(?:\s+and\s+maintain)?`;
const CLEARANCE_OBTAIN_RE = [
  exact(
    String.raw`\b${CANDIDATE_SUBJECT}\s+(?:(?:must|need(?:s)?\s+to|will\s+need\s+to)\s+(?:be\s+)?|(?:is|are|will\s+be)\s+required\s+to\s+(?:be\s+)?)(?:eligible|able|willing)\s+(?:to\s+${CLEARANCE_ACQUISITION}|for)\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`,
  ),
  exact(
    String.raw`^(?:must|need\s+to|required\s+to|will\s+need\s+to)\s+(?:be\s+)?(?:eligible|able|willing)\s+(?:to\s+${CLEARANCE_ACQUISITION}|for)\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`,
  ),
  exact(
    String.raw`^(?:the\s+)?(?:ability|eligibility)\s+to\s+${CLEARANCE_ACQUISITION}\s+${CLEARANCE_VALUE}\s+(?:is\s+)?${HARD_POSTFIX}\b${POSTFIX_END}`,
  ),
  exact(
    String.raw`\b(?:this\s+)?(?:role|position|job)\s+requires?\s+(?:the\s+)?(?:ability|eligibility)\s+to\s+${CLEARANCE_ACQUISITION}\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`,
  ),
  exact(String.raw`^eligibility\s*:\s*(?:the\s+)?(?:ability|eligibility)\s+to\s+${CLEARANCE_ACQUISITION}\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`),
  exact(String.raw`^(?:must|required\s+to|need\s+to)\s+${CLEARANCE_ACQUISITION}\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`),
  exact(String.raw`\b${CANDIDATE_SUBJECT}\s+(?:(?:must|need(?:s)?\s+to|will\s+need\s+to)\s+|(?:is|are|will\s+be)\s+required\s+to\s+)${CLEARANCE_ACQUISITION}\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`),
  exact(String.raw`^(?:must|required\s+to|need\s+to)\s+hold\s+or\s+be\s+(?:eligible|able|willing)\s+to\s+${CLEARANCE_ACQUISITION}\s+${CLEARANCE_VALUE}${CLOSED_GATE_END}`),
];

function splitClauses(description: string): Clause[] {
  const clauses: Clause[] = [];
  let cursor = 0;

  function push(start: number, end: number): void {
    const raw = description.slice(start, end);
    const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
    const trimmedStart = start + leading;
    const trimmedEnd = Math.max(trimmedStart, end - trailing);
    const clause = description.slice(trimmedStart, trimmedEnd);
    if (!clause) return;
    const normalized = clause
      .normalize("NFKC")
      .toLocaleLowerCase("en-AU")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&(?:nbsp|amp|quot|apos);/giu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      // Contrast boundaries start before "but/however", so the preceding
      // clause may retain a comma. Ignore only that matching punctuation;
      // evidence text and UTF-16 offsets continue to reference the source.
      .replace(/[,;:]\s*$/u, "");
    if (!normalized) return;
    clauses.push({ clause, start: trimmedStart, end: trimmedEnd, normalized });
  }

  CLAUSE_BOUNDARY_RE.lastIndex = 0;
  for (const match of description.matchAll(CLAUSE_BOUNDARY_RE)) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, description.length);
  return clauses;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function excluded(
  clause: Clause,
  reasonCode: AuEligibilityReasonCode,
): AuEligibilityDecision {
  return {
    verdict: "EXCLUDE",
    policyVersion: AU_ELIGIBILITY_POLICY_VERSION,
    confidence: "EXPLICIT",
    reasonCode,
    evidence: {
      clause: clause.clause,
      start: clause.start,
      end: clause.end,
    },
  };
}

function kept(): AuEligibilityDecision {
  return {
    verdict: "KEEP",
    policyVersion: AU_ELIGIBILITY_POLICY_VERSION,
    confidence: "NONE",
  };
}

/**
 * Policy A is deliberately fail-open. It excludes only an explicit applicant
 * gate in one clause; work-right, sponsorship, certifications, preferences,
 * and project/background mentions never become hard exclusions.
 */
export function evaluateAuEligibility(
  description: string | null | undefined,
  options: AuEligibilityPolicyOptions = {},
): AuEligibilityDecision {
  if (!description?.trim()) return kept();
  const identityOn = options.identityRequirement ?? true;
  const clearanceOn = options.clearanceRequirement ?? true;
  if (!identityOn && !clearanceOn) return kept();

  for (const clause of splitClauses(description)) {
    if (identityOn) {
      if (INVERSE_CITIZEN_REQUIREMENT_RE.test(clause.normalized)) {
        return excluded(clause, "AU_CITIZEN_REQUIRED");
      }
      if (matchesAny(clause.normalized, CITIZEN_REQUIRED_RE)) {
        return excluded(clause, "AU_CITIZEN_REQUIRED");
      }
      if (matchesAny(clause.normalized, PR_REQUIRED_RE)) {
        return excluded(clause, "AU_PR_REQUIRED");
      }
    }

    if (clearanceOn) {
      if (matchesAny(clause.normalized, CLEARANCE_OBTAIN_RE)) {
        return excluded(clause, "AU_CLEARANCE_OBTAIN_REQUIRED");
      }
      if (matchesAny(clause.normalized, BASELINE_REQUIRED_RE)) {
        return excluded(clause, "AU_BASELINE_REQUIRED");
      }
      if (matchesAny(clause.normalized, NV1_REQUIRED_RE)) {
        return excluded(clause, "AU_NV1_REQUIRED");
      }
      if (matchesAny(clause.normalized, NV2_REQUIRED_RE)) {
        return excluded(clause, "AU_NV2_REQUIRED");
      }
      if (matchesAny(clause.normalized, GOVERNMENT_CLEARANCE_REQUIRED_RE)) {
        return excluded(clause, "AU_GOV_CLEARANCE_REQUIRED");
      }
    }
  }

  return kept();
}
