// Deterministic posting-risk scoring — the third axis alongside role fit
// (fitScore/fitVerdict) and eligibility (fitEligibility).
//
// Zero LLM, zero network: this runs inline on every imported row. It NEVER
// drops a job. Scam and ghost postings are surfaced with a flag so the user
// decides, which is the same contract as the reversible ignore flow and the
// DeletedJobUrl tombstone — Joblit does not silently discard the user's data.

export type PostingRiskFlag =
  | "invalid_url"
  | "suspicious_domain"
  | "company_domain_mismatch";

export type PostingRiskBand = "low" | "medium" | "high";

export interface PostingRiskResult {
  /** 0-100, higher is riskier. 0 means no signal fired. */
  score: number;
  flags: PostingRiskFlag[];
  band: PostingRiskBand;
}

const PENALTIES: Record<PostingRiskFlag, number> = {
  invalid_url: 50,
  suspicious_domain: 25,
  company_domain_mismatch: 15,
};

/** Link shorteners and generic form hosts hide the real destination, which is
 *  the standard shape of a recruitment scam. */
const SUSPICIOUS_HOSTS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "forms.gle",
  "goo.gl",
  "shorturl.at",
  "rebrand.ly",
  "cutt.ly",
  "is.gd",
  "ow.ly",
];

// Hosts where a company/hostname mismatch carries no signal, because the
// posting legitimately lives on someone else's domain. Joblit ingests almost
// exclusively from aggregators and ATS tenants, so without this list the
// mismatch rule would fire on essentially every row and mean nothing.
const NEUTRAL_HOSTS = [
  // Aggregators and job boards
  "linkedin.com",
  "seek.com.au",
  "indeed.com",
  "glassdoor.com",
  "remoteok.com",
  "remotive.com",
  "jobicy.com",
  "himalayas.app",
  "weworkremotely.com",
  "workingnomads.com",
  "nodesk.co",
  "jobspresso.co",
  "nowcoder.com",
  "zhipin.com",
  "liepin.com",
  "51job.com",
  "zhaopin.com",
  // ATS tenants
  "greenhouse.io",
  "ashbyhq.com",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "jobvite.com",
  "recruitee.com",
  "workable.com",
  "icims.com",
  "taleo.net",
  "applytojob.com",
  "breezy.hr",
  "bamboohr.com",
  "teamtailor.com",
  "personio.com",
  "employmenthero.com",
];

/** Hostname equals the entry or is a subdomain of it. Anchored on a dot so
 *  "evil-bit.ly.example.com" cannot satisfy a "bit.ly" entry. */
function hostMatches(hostname: string, list: readonly string[]): boolean {
  return list.some(
    (entry) => hostname === entry || hostname.endsWith(`.${entry}`),
  );
}

/**
 * Does the company name plausibly appear in the hostname? Returns true when it
 * does, or when there is not enough information to judge — an absent company
 * is unknown, not suspicious.
 */
function companyMatchesHost(company: string, hostname: string): boolean {
  const normalized = company.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (!normalized) return true;

  const slug = normalized.replace(/\s+/g, "");
  if (slug && hostname.includes(slug)) return true;

  // Any single significant word is enough: "Canva Pty Ltd" should match
  // jobs.canva.com without the legal suffix defeating it.
  return normalized
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .some((word) => hostname.includes(word));
}

function bandFor(score: number): PostingRiskBand {
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function scorePostingRisk(input: {
  jobUrl: string;
  company?: string | null;
}): PostingRiskResult {
  const flags: PostingRiskFlag[] = [];
  const raw = (input.jobUrl ?? "").trim();

  let parsed: URL | null = null;
  if (raw) {
    try {
      const candidate = new URL(raw);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") {
        parsed = candidate;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    // No usable hostname, so every remaining rule would be a guess. Stop here.
    const score = PENALTIES.invalid_url;
    return { score, flags: ["invalid_url"], band: bandFor(score) };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostMatches(hostname, SUSPICIOUS_HOSTS)) {
    flags.push("suspicious_domain");
  }

  const company = (input.company ?? "").trim();
  if (
    company &&
    !hostMatches(hostname, NEUTRAL_HOSTS) &&
    !companyMatchesHost(company, hostname)
  ) {
    flags.push("company_domain_mismatch");
  }

  const score = Math.min(
    100,
    flags.reduce((total, flag) => total + PENALTIES[flag], 0),
  );
  return { score, flags, band: bandFor(score) };
}
