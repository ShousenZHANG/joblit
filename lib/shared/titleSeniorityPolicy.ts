/**
 * Deterministic senior-title policy shared in behaviour with the AU worker.
 *
 * This module deliberately reads only the visible title. Source-provided
 * `jobLevel` / `seniorityLevel` values are noisy hints and must never remove a
 * role the user could otherwise see. Ambiguous language fails open.
 */

export type TitleSeniorityRuleId =
  | "TITLE_ALLOWED"
  | "TITLE_AMBIGUOUS_FAIL_OPEN"
  | "TITLE_SENIOR"
  | "TITLE_PRINCIPAL"
  | "TITLE_LEAD"
  | "TITLE_STAFF"
  | "TITLE_MANAGER"
  | "TITLE_DIRECTOR"
  | "TITLE_HEAD"
  | "TITLE_ARCHITECT"
  | "TITLE_EXECUTIVE"
  | "TITLE_CUSTOM";

export type TitleSeniorityDecision = {
  outcome: "KEEP" | "EXCLUDE";
  ruleId: TitleSeniorityRuleId;
  evidence: string | null;
};

type Token = { value: string; start: number; end: number };

type ExclusionRuleId = Exclude<
  TitleSeniorityRuleId,
  "TITLE_ALLOWED" | "TITLE_AMBIGUOUS_FAIL_OPEN" | "TITLE_CUSTOM"
>;

const ALL_EXCLUSION_RULES: ReadonlySet<ExclusionRuleId> = new Set([
  "TITLE_SENIOR",
  "TITLE_PRINCIPAL",
  "TITLE_LEAD",
  "TITLE_STAFF",
  "TITLE_MANAGER",
  "TITLE_DIRECTOR",
  "TITLE_HEAD",
  "TITLE_ARCHITECT",
  "TITLE_EXECUTIVE",
]);

const LEGACY_TERM_RULE = new Map<string, ExclusionRuleId>([
  ["senior", "TITLE_SENIOR"],
  ["sr", "TITLE_SENIOR"],
  ["snr", "TITLE_SENIOR"],
  ["principal", "TITLE_PRINCIPAL"],
  ["lead", "TITLE_LEAD"],
  ["staff", "TITLE_STAFF"],
  ["manager", "TITLE_MANAGER"],
  ["director", "TITLE_DIRECTOR"],
  ["head", "TITLE_HEAD"],
  ["architect", "TITLE_ARCHITECT"],
  ["chief", "TITLE_EXECUTIVE"],
  ["vp", "TITLE_EXECUTIVE"],
  ["vice president", "TITLE_EXECUTIVE"],
  ["distinguished", "TITLE_EXECUTIVE"],
]);

const SENIOR_ALIASES = new Set(["senior", "sr", "snr"]);

const EXPLICIT_ROLE_PHRASES = [
  ["analyst"],
  ["architect"],
  ["consultant"],
  ["designer"],
  ["developer"],
  ["engineer"],
  ["researcher"],
  ["scientist"],
  ["specialist"],
  ["business", "analyst"],
  ["cloud", "architect"],
  ["cloud", "engineer"],
  ["data", "analyst"],
  ["data", "engineer"],
  ["data", "scientist"],
  ["devops", "engineer"],
  ["platform", "engineer"],
  ["product", "designer"],
  ["qa", "engineer"],
  ["security", "engineer"],
  ["software", "architect"],
  ["software", "developer"],
  ["software", "engineer"],
  ["solutions", "architect"],
  ["systems", "engineer"],
  ["technical", "consultant"],
] as const;

const EXPLICIT_ROLE_NOUNS = new Set([
  "analyst",
  "architect",
  "consultant",
  "designer",
  "developer",
  "engineer",
  "researcher",
  "scientist",
  "specialist",
]);

const LEAD_FUNCTION_SUFFIXES = new Set([
  "capability",
  "chapter",
  "data",
  "delivery",
  "design",
  "discipline",
  "engineering",
  "platform",
  "practice",
  "product",
  "program",
  "project",
  "security",
  "software",
  "team",
  "tech",
  "technical",
  "technology",
]);

const MANAGER_FUNCTIONS = new Set([
  "account",
  "change",
  "configuration",
  "customer",
  "data",
  "delivery",
  "development",
  "engineering",
  "environment",
  "finance",
  "implementation",
  "incident",
  "infrastructure",
  "marketing",
  "operations",
  "people",
  "platform",
  "portfolio",
  "practice",
  "product",
  "program",
  "project",
  "quality",
  "release",
  "sales",
  "security",
  "service",
  "services",
  "software",
  "success",
  "support",
  "team",
  "technical",
  "technology",
  "test",
]);

const HEAD_FUNCTIONS = new Set([
  "chapter",
  "data",
  "department",
  "development",
  "engineering",
  "function",
  "infrastructure",
  "platform",
  "practice",
  "product",
  "security",
  "software",
  "team",
  "technical",
  "technology",
]);

const ARCHITECT_EARLY_CAREER_TOKENS = new Set([
  "associate",
  "entry",
  "graduate",
  "intern",
  "jr",
  "junior",
  "trainee",
]);

const CONFLICT_EARLY_CAREER_TOKENS = new Set([
  "entry",
  "graduate",
  "intern",
  "jr",
  "junior",
  "trainee",
]);

const LEVEL_SUFFIXES = new Set(["i", "ii", "iii", "iv", "1", "2", "3", "4"]);

/**
 * Positive grammar for level words whose everyday/technical meanings are
 * otherwise too broad to exclude safely. A level must modify a recognisable
 * role through a short, controlled modifier path; unknown context fails open.
 */
const LEVELLED_ROLE_NOUNS = new Set([
  "administrator",
  "analyst",
  "architect",
  "consultant",
  "coordinator",
  "designer",
  "developer",
  "director",
  "engineer",
  "investigator",
  "manager",
  "officer",
  "owner",
  "programmer",
  "researcher",
  "scientist",
  "specialist",
  "technician",
]);

const LEVELLED_ROLE_MODIFIERS = new Set([
  "ai",
  "android",
  "application",
  "applications",
  "associate",
  "backend",
  "business",
  "c",
  "cloud",
  "cyber",
  "cybersecurity",
  "data",
  "database",
  "devsecops",
  "devops",
  "digital",
  "embedded",
  "engineering",
  "enterprise",
  "frontend",
  "full",
  "infrastructure",
  "integration",
  "ios",
  "it",
  "java",
  "learning",
  "machine",
  "ml",
  "mobile",
  "net",
  "network",
  "platform",
  "product",
  "python",
  "qa",
  "react",
  "reliability",
  "research",
  "security",
  "site",
  "software",
  "solution",
  "solutions",
  "stack",
  "system",
  "systems",
  "technical",
  "test",
  "web",
]);

const MAX_LEVELLED_ROLE_MODIFIERS = 3;

function normalize(value: string): string {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  const matcher = /[a-z0-9]+/g;
  for (const match of value.matchAll(matcher)) {
    const start = match.index ?? 0;
    tokens.push({ value: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

function phraseAt(tokens: readonly Token[], start: number, phrase: readonly string[]): boolean {
  if (start < 0 || start + phrase.length > tokens.length) return false;
  return phrase.every((part, offset) => tokens[start + offset]?.value === part);
}

function matchesExplicitRoleAt(
  tokens: readonly Token[],
  start: number,
): boolean {
  return EXPLICIT_ROLE_PHRASES.some((phrase) => phraseAt(tokens, start, phrase));
}

function hasStructuralSeparatorAfter(
  normalizedTitle: string,
  token: Token,
  nextToken: Token | undefined,
): boolean {
  if (!nextToken) return false;
  return /[,/|:;–—-]/.test(normalizedTitle.slice(token.end, nextToken.start));
}

function aliasEnabled(
  ruleId: ExclusionRuleId,
  alias: string,
  enabledAliases: ReadonlyMap<ExclusionRuleId, ReadonlySet<string>> | undefined,
): boolean {
  const aliases = enabledAliases?.get(ruleId);
  return aliases == null || aliases.has(alias);
}

function exclude(ruleId: TitleSeniorityRuleId, evidence: string): TitleSeniorityDecision {
  return { outcome: "EXCLUDE", ruleId, evidence };
}

function ambiguous(evidence: string): TitleSeniorityDecision {
  return { outcome: "KEEP", ruleId: "TITLE_AMBIGUOUS_FAIL_OPEN", evidence };
}

function tokenEvidence(token: Token): string {
  return token.value;
}

type RuleContext = {
  normalizedTitle: string;
  tokens: readonly Token[];
  hasEarlyCareerConflict: boolean;
  enabledAliases?: ReadonlyMap<ExclusionRuleId, ReadonlySet<string>>;
};

type RuleEvaluator = (context: RuleContext) => TitleSeniorityDecision | null;

function firstAmbiguous(evidence: string | null): TitleSeniorityDecision | null {
  return evidence ? ambiguous(evidence) : null;
}

function hasStructuralSeparatorBefore(
  normalizedTitle: string,
  previousToken: Token | undefined,
  token: Token,
): boolean {
  if (!previousToken) return false;
  return /[,/|:;–—()\[\]-]/.test(
    normalizedTitle.slice(previousToken.end, token.start),
  );
}

function matchesLevelledRolePrefix(
  tokens: readonly Token[],
  levelIndex: number,
): boolean {
  let cursor = levelIndex + 1;
  if (LEVELLED_ROLE_NOUNS.has(tokens[cursor]?.value ?? "")) return true;

  let modifierCount = 0;
  while (
    modifierCount < MAX_LEVELLED_ROLE_MODIFIERS &&
    LEVELLED_ROLE_MODIFIERS.has(tokens[cursor]?.value ?? "")
  ) {
    cursor += 1;
    modifierCount += 1;
  }
  return (
    modifierCount > 0 &&
    LEVELLED_ROLE_NOUNS.has(tokens[cursor]?.value ?? "")
  );
}

function matchesLevelledRoleSuffix(
  normalizedTitle: string,
  tokens: readonly Token[],
  levelIndex: number,
): boolean {
  const previous = tokens[levelIndex - 1];
  if (
    !previous ||
    !LEVELLED_ROLE_NOUNS.has(previous.value) ||
    !hasStructuralSeparatorBefore(
      normalizedTitle,
      previous,
      tokens[levelIndex]!,
    )
  ) {
    return false;
  }
  return tokens
    .slice(levelIndex + 1)
    .every((token) => LEVEL_SUFFIXES.has(token.value));
}

function matchesLevelledRoleAt(
  context: RuleContext,
  levelIndex: number,
): boolean {
  return (
    matchesLevelledRolePrefix(context.tokens, levelIndex) ||
    matchesLevelledRoleSuffix(
      context.normalizedTitle,
      context.tokens,
      levelIndex,
    )
  );
}

function evaluateExecutiveRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      token &&
      ["chief", "vp", "distinguished"].includes(token.value) &&
      aliasEnabled(
        "TITLE_EXECUTIVE",
        token.value,
        context.enabledAliases,
      )
    ) {
      return context.hasEarlyCareerConflict
        ? ambiguous(tokenEvidence(token))
        : exclude("TITLE_EXECUTIVE", tokenEvidence(token));
    }
    if (
      token?.value === "vice" &&
      context.tokens[index + 1]?.value === "president" &&
      aliasEnabled(
        "TITLE_EXECUTIVE",
        "vice president",
        context.enabledAliases,
      )
    ) {
      return context.hasEarlyCareerConflict
        ? ambiguous("vice president")
        : exclude("TITLE_EXECUTIVE", "vice president");
    }
  }
  return null;
}

function evaluateDirectorRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  const token = context.tokens.find(
    (candidate) =>
      candidate.value === "director" &&
      aliasEnabled(
        "TITLE_DIRECTOR",
        candidate.value,
        context.enabledAliases,
      ),
  );
  if (!token) return null;
  return context.hasEarlyCareerConflict
    ? ambiguous(tokenEvidence(token))
    : exclude("TITLE_DIRECTOR", tokenEvidence(token));
}

function evaluateHeadRule(context: RuleContext): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      token?.value !== "head" ||
      !aliasEnabled("TITLE_HEAD", token.value, context.enabledAliases)
    ) {
      continue;
    }
    if (context.hasEarlyCareerConflict) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    const previous = context.tokens[index - 1]?.value;
    const next = context.tokens[index + 1]?.value;
    if (
      next === "of" ||
      (index === 0 && next != null && HEAD_FUNCTIONS.has(next)) ||
      (index === context.tokens.length - 1 &&
        previous != null &&
        HEAD_FUNCTIONS.has(previous))
    ) {
      return exclude("TITLE_HEAD", tokenEvidence(token));
    }
    ambiguousEvidence ??= tokenEvidence(token);
  }
  return firstAmbiguous(ambiguousEvidence);
}

function evaluatePrincipalRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      token?.value !== "principal" ||
      !aliasEnabled("TITLE_PRINCIPAL", token.value, context.enabledAliases)
    ) {
      continue;
    }
    const suffix = context.normalizedTitle.slice(token.end);
    if (/^\s*['’]s\b/.test(suffix)) {
      ambiguousEvidence ??= "principal's";
      continue;
    }
    if (
      context.hasEarlyCareerConflict ||
      !matchesLevelledRoleAt(context, index)
    ) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    return exclude("TITLE_PRINCIPAL", tokenEvidence(token));
  }
  return firstAmbiguous(ambiguousEvidence);
}

function evaluateManagerRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      token?.value !== "manager" ||
      !aliasEnabled("TITLE_MANAGER", token.value, context.enabledAliases)
    ) {
      continue;
    }
    if (context.hasEarlyCareerConflict) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    const previous = context.tokens[index - 1]?.value;
    const nextToken = context.tokens[index + 1];
    const next = nextToken?.value;
    const hasOnlyLevelSuffix = context.tokens
      .slice(index + 1)
      .every((part) => LEVEL_SUFFIXES.has(part.value));
    if (
      (previous != null &&
        MANAGER_FUNCTIONS.has(previous) &&
        hasOnlyLevelSuffix) ||
      (next === "of" &&
        MANAGER_FUNCTIONS.has(context.tokens[index + 2]?.value ?? "")) ||
      (next != null &&
        MANAGER_FUNCTIONS.has(next) &&
        hasStructuralSeparatorAfter(
          context.normalizedTitle,
          token,
          nextToken,
        ))
    ) {
      return exclude("TITLE_MANAGER", tokenEvidence(token));
    }
    ambiguousEvidence ??= tokenEvidence(token);
  }
  return firstAmbiguous(ambiguousEvidence);
}

function evaluateArchitectRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  const hasEarlyCareerArchitect = context.tokens.some((candidate) =>
    ARCHITECT_EARLY_CAREER_TOKENS.has(candidate.value),
  );
  for (const token of context.tokens) {
    if (
      token.value !== "architect" ||
      !aliasEnabled("TITLE_ARCHITECT", token.value, context.enabledAliases)
    ) {
      continue;
    }
    if (hasEarlyCareerArchitect) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    return exclude("TITLE_ARCHITECT", tokenEvidence(token));
  }
  return firstAmbiguous(ambiguousEvidence);
}

function evaluateStaffRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      token?.value !== "staff" ||
      !aliasEnabled("TITLE_STAFF", token.value, context.enabledAliases)
    ) {
      continue;
    }
    if (context.hasEarlyCareerConflict) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    const previous = context.tokens[index - 1]?.value;
    if (
      (index === 0 && matchesExplicitRoleAt(context.tokens, index + 1)) ||
      (index === context.tokens.length - 1 &&
        previous != null &&
        EXPLICIT_ROLE_NOUNS.has(previous))
    ) {
      return exclude("TITLE_STAFF", tokenEvidence(token));
    }
    ambiguousEvidence ??= tokenEvidence(token);
  }
  return firstAmbiguous(ambiguousEvidence);
}

function evaluateLeadRule(context: RuleContext): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      token?.value !== "lead" ||
      !aliasEnabled("TITLE_LEAD", token.value, context.enabledAliases)
    ) {
      continue;
    }
    if (context.hasEarlyCareerConflict) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    const previous = context.tokens[index - 1]?.value;
    if (
      (index === 0 && matchesExplicitRoleAt(context.tokens, index + 1)) ||
      (previous != null && LEAD_FUNCTION_SUFFIXES.has(previous))
    ) {
      return exclude("TITLE_LEAD", tokenEvidence(token));
    }
    ambiguousEvidence ??= tokenEvidence(token);
  }
  return firstAmbiguous(ambiguousEvidence);
}

function evaluateSeniorRule(
  context: RuleContext,
): TitleSeniorityDecision | null {
  let ambiguousEvidence: string | null = null;
  for (let index = 0; index < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    if (
      !token ||
      !SENIOR_ALIASES.has(token.value) ||
      !aliasEnabled("TITLE_SENIOR", token.value, context.enabledAliases)
    ) {
      continue;
    }
    if (
      context.hasEarlyCareerConflict ||
      !matchesLevelledRoleAt(context, index)
    ) {
      ambiguousEvidence ??= tokenEvidence(token);
      continue;
    }
    return exclude("TITLE_SENIOR", tokenEvidence(token));
  }
  return firstAmbiguous(ambiguousEvidence);
}

const RULE_EVALUATORS: readonly (readonly [ExclusionRuleId, RuleEvaluator])[] = [
  ["TITLE_EXECUTIVE", evaluateExecutiveRule],
  ["TITLE_DIRECTOR", evaluateDirectorRule],
  ["TITLE_HEAD", evaluateHeadRule],
  ["TITLE_PRINCIPAL", evaluatePrincipalRule],
  ["TITLE_MANAGER", evaluateManagerRule],
  ["TITLE_ARCHITECT", evaluateArchitectRule],
  ["TITLE_STAFF", evaluateStaffRule],
  ["TITLE_LEAD", evaluateLeadRule],
  ["TITLE_SENIOR", evaluateSeniorRule],
];

/**
 * Classify one visible job title. Unknown, conflicting, and context-dependent
 * phrases remain eligible; only a high-confidence senior-title grammar is
 * excluded.
 */
function evaluateTitleSeniorityWithRules(
  title: string,
  enabledRules: ReadonlySet<ExclusionRuleId>,
  enabledAliases?: ReadonlyMap<ExclusionRuleId, ReadonlySet<string>>,
): TitleSeniorityDecision {
  const normalizedTitle = normalize(title);
  const tokens = tokenize(normalizedTitle);
  const context: RuleContext = {
    normalizedTitle,
    tokens,
    hasEarlyCareerConflict: tokens.some((token) =>
      CONFLICT_EARLY_CAREER_TOKENS.has(token.value),
    ),
    enabledAliases,
  };
  let ambiguousEvidence: string | null = null;

  for (const [ruleId, evaluator] of RULE_EVALUATORS) {
    if (!enabledRules.has(ruleId)) continue;
    const decision = evaluator(context);
    if (!decision) continue;
    if (decision.outcome === "EXCLUDE") return decision;
    ambiguousEvidence ??= decision.evidence;
  }

  return ambiguousEvidence
    ? ambiguous(ambiguousEvidence)
    : { outcome: "KEEP", ruleId: "TITLE_ALLOWED", evidence: null };
}

function evaluateAuRecallSafeV1Title(title: string): TitleSeniorityDecision {
  return evaluateTitleSeniorityWithRules(title, ALL_EXCLUSION_RULES);
}

const AU_RECALL_SAFE_V1_TITLE_POLICY_ID = "au-recall-safe-v1";

const TITLE_POLICY_EVALUATORS: ReadonlyMap<
  string,
  (title: string) => TitleSeniorityDecision
> = new Map([
  [AU_RECALL_SAFE_V1_TITLE_POLICY_ID, evaluateAuRecallSafeV1Title],
]);

export function evaluateTitleSeniorityForPolicy(
  title: string,
  policyId: string,
): TitleSeniorityDecision {
  const evaluator = TITLE_POLICY_EVALUATORS.get(policyId);
  if (!evaluator) throw new Error(`Unsupported title seniority policy: ${policyId}`);
  return evaluator(title);
}

function normalizedLegacyTerm(term: string): string {
  return tokenize(normalize(term))
    .map((token) => token.value)
    .join(" ");
}

function containsCustomTerm(title: string, rawTerm: string): boolean {
  const titleTokens = tokenize(normalize(title)).map((token) => token.value);
  const termTokens = tokenize(normalize(rawTerm)).map((token) => token.value);
  if (termTokens.length === 0) {
    const term = normalize(rawTerm).trim();
    return Boolean(term) && normalize(title).includes(term);
  }
  for (let start = 0; start <= titleTokens.length - termTokens.length; start += 1) {
    if (termTokens.every((part, offset) => titleTokens[start + offset] === part)) return true;
  }
  return false;
}

/**
 * Compatibility adapter for persisted v1 FetchRun title terms. Recognised
 * seniority terms opt into only their stored rule; all other custom terms keep
 * historical exclusion intent but use whole-term matching.
 */
export function evaluateLegacyTitleExclusions(
  title: string,
  configuredTerms: readonly string[],
): TitleSeniorityDecision {
  const enabledRules = new Set<ExclusionRuleId>();
  const enabledAliases = new Map<ExclusionRuleId, Set<string>>();
  const customTerms: string[] = [];
  for (const rawTerm of configuredTerms) {
    const term = normalizedLegacyTerm(rawTerm);
    if (!term) continue;
    const rule = LEGACY_TERM_RULE.get(term);
    if (rule) {
      enabledRules.add(rule);
      const aliases = enabledAliases.get(rule) ?? new Set<string>();
      aliases.add(term);
      enabledAliases.set(rule, aliases);
    } else customTerms.push(rawTerm);
  }

  const seniorityDecision = evaluateTitleSeniorityWithRules(
    title,
    enabledRules,
    enabledAliases,
  );
  if (seniorityDecision.outcome === "EXCLUDE") return seniorityDecision;

  const customMatch = customTerms.find((term) => containsCustomTerm(title, term));
  if (customMatch) return exclude("TITLE_CUSTOM", normalize(customMatch).trim());
  return seniorityDecision;
}
