export interface ApplicationCooldownCandidate {
  company: string;
  title: string;
  /** Stable role family such as backend, data, product, or design. */
  roleFamily?: string | null;
}

export interface ApplicationCooldownRule {
  company: string;
  lastApplyDate: string | Date;
  sameRoleDays: number;
  /** Exact titles already submitted to at this company. */
  appliedTo?: readonly string[];
  /** Role families sharing the same cooldown bucket. */
  crossRoleBucket?: string | readonly string[];
}

export type ApplicationCooldownMatch =
  | "exact_role"
  | "role_family"
  | "company";

export interface ApplicationCooldownDecision {
  suppressed: boolean;
  match: ApplicationCooldownMatch | null;
  daysRemaining: number;
  matchedRule: ApplicationCooldownRule | null;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompany(value: string): string {
  const legalSuffixes = new Set([
    "ag",
    "bv",
    "pty",
    "plc",
    "pte",
    "ltd",
    "limited",
    "inc",
    "llc",
    "gmbh",
    "nv",
    "sarl",
    "sas",
    "corp",
    "corporation",
    "company",
    "co",
  ]);
  const normalized = normalize(value)
    .replace(/(?:股份)?有限公司$/u, "")
    .replace(/有限责任公司$/u, "")
    .trim();
  const tokens = normalized
    .split(" ")
    .filter((token) => token && !legalSuffixes.has(token));
  return tokens.join(" ");
}

function roleBuckets(value: string | readonly string[] | undefined): string[] {
  const values = typeof value === "string" ? [value] : value ?? [];
  return values.map(normalize).filter(Boolean);
}

function inactiveDecision(): ApplicationCooldownDecision {
  return {
    suppressed: false,
    match: null,
    daysRemaining: 0,
    matchedRule: null,
  };
}

/**
 * Evaluate explicit company cooldown policy. Invalid dates fail open; a bad
 * imported timestamp must never hide a job indefinitely.
 */
export function evaluateApplicationCooldown(
  candidate: ApplicationCooldownCandidate,
  rules: readonly ApplicationCooldownRule[],
  now: string | Date = new Date(),
): ApplicationCooldownDecision {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return inactiveDecision();

  const company = normalizeCompany(candidate.company);
  const title = normalize(candidate.title);
  const family = normalize(candidate.roleFamily ?? "");
  let best = inactiveDecision();

  for (const rule of rules) {
    if (!company || normalizeCompany(rule.company) !== company) continue;
    const appliedAt = new Date(rule.lastApplyDate).getTime();
    if (!Number.isFinite(appliedAt)) continue;
    const windowDays = Number.isFinite(rule.sameRoleDays)
      ? Math.max(0, rule.sameRoleDays)
      : 0;
    // A future timestamp can happen through client clock skew. Clamp it to now
    // so malformed data cannot hide a company for longer than policy allows.
    const expiresAt = Math.min(appliedAt, nowMs) + windowDays * 86_400_000;
    if (expiresAt <= nowMs) continue;

    const appliedTitles = (rule.appliedTo ?? []).map(normalize).filter(Boolean);
    const buckets = roleBuckets(rule.crossRoleBucket);
    let match: ApplicationCooldownMatch | null = null;
    if (title && appliedTitles.includes(title)) {
      match = "exact_role";
    } else if (family && buckets.includes(family)) {
      match = "role_family";
    } else if (!appliedTitles.length && !buckets.length) {
      match = "company";
    }
    if (!match) continue;

    const daysRemaining = Math.max(
      1,
      Math.ceil((expiresAt - nowMs) / 86_400_000),
    );
    if (!best.suppressed || daysRemaining > best.daysRemaining) {
      best = { suppressed: true, match, daysRemaining, matchedRule: rule };
    }
  }
  return best;
}

/** Build Array.filter-compatible predicate: true means keep candidate. */
export function buildCooldownFilter(
  rules: readonly ApplicationCooldownRule[],
  now: string | Date = new Date(),
): (candidate: ApplicationCooldownCandidate) => boolean {
  return (candidate) =>
    !evaluateApplicationCooldown(candidate, rules, now).suppressed;
}
