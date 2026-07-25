import { createHash } from "node:crypto";
import { extractTopResponsibilities } from "@/lib/server/ai/responsibilityCoverage";
import {
  acceptedAddedBulletTexts,
  addedBulletText,
  coverParagraphTexts,
  proposalText,
} from "@/lib/shared/aiContentText";
import type {
  AiApplicationReview,
  AiContent,
  AiEvidenceReference,
} from "@/lib/shared/schemas/aiContent";

type EvidenceKind = AiEvidenceReference["kind"];

type EvidenceInput = {
  aiContent: AiContent;
  resumeSnapshot: unknown;
  jobDescription: string | null | undefined;
  /**
   * The tenant every evidence id is derived from — always the user id.
   *
   * Required, not defaulted. It used to be optional with an "anonymous"
   * fallback, so a caller that forgot it minted ids under the wrong scope and
   * the mistake only surfaced later, as an INVALID_EVIDENCE_REFERENCE from
   * assertCanonicalEvidenceReferences at persist time.
   */
  scopeKey: string;
};

const MAX_EVIDENCE_ITEMS = 280;
const MAX_EVIDENCE_EXCERPT = 480;
const MAX_REVIEW_REQUIREMENTS = 8;
const NUMBER_CLAIM_RE =
  /(?:^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?%|\d{2,}(?:[.,]\d+)?|\d+\s*(?:years?|yrs?|x)\b)(?=$|[^\p{L}\p{N}])/giu;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableId(prefix: "ev" | "req", value: string) {
  return `${prefix}_${sha256(value).slice(0, prefix === "ev" ? 32 : 16)}`;
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  const normalized = normalize(value);
  const result = new Set<string>();

  for (const match of normalized.matchAll(/[\p{L}\p{N}+#./-]+/gu)) {
    const token = match[0];
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
      if (token.length === 1) result.add(token);
      for (let index = 0; index < token.length - 1; index += 1) {
        result.add(token.slice(index, index + 2));
      }
      continue;
    }
    if (token.length >= 2) result.add(token);
  }

  return result;
}

function overlapScore(left: string, right: string) {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft.length > 0 && normalizedLeft === normalizedRight) return 1;

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function minimumEvidenceLength(kind: EvidenceKind, path: string) {
  // Short skill names (R, C, C#, Go, AWS) are valid evidence when they come
  // from the server-owned resume skills tree.
  return kind === "candidate" && path.toLowerCase().includes("skill") ? 1 : 4;
}

function makeEvidence(
  kind: EvidenceKind,
  path: string,
  text: string,
  scopeKey: string,
): AiEvidenceReference | null {
  const excerpt = normalize(text).slice(0, MAX_EVIDENCE_EXCERPT);
  if (excerpt.length < minimumEvidenceLength(kind, path)) return null;
  const contentHash = sha256(excerpt);
  return {
    id: stableId("ev", `${scopeKey}\n${kind}\n${contentHash}`),
    kind,
    path,
    contentHash,
    excerpt,
  };
}

function collectCandidateEvidence(value: unknown, scopeKey: string) {
  const output: AiEvidenceReference[] = [];
  const seen = new Set<string>();

  const visit = (current: unknown, path: string, depth: number) => {
    if (output.length >= MAX_EVIDENCE_ITEMS || depth > 7 || current == null) return;
    if (typeof current === "string") {
      const item = makeEvidence("candidate", path, current, scopeKey);
      if (item && !seen.has(item.contentHash)) {
        seen.add(item.contentHash);
        output.push(item);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.slice(0, 80).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof current !== "object") return;

    for (const [key, item] of Object.entries(current as Record<string, unknown>).slice(0, 80)) {
      if (/^(?:id|userId|revision|createdAt|updatedAt)$/i.test(key)) continue;
      visit(item, path ? `${path}.${key}` : key, depth + 1);
    }
  };

  visit(value, "resume", 0);
  return output;
}

function collectJobEvidence(
  description: string | null | undefined,
  scopeKey: string,
) {
  const text = (description ?? "").trim();
  if (!text) return [] as AiEvidenceReference[];

  const responsibilities = extractTopResponsibilities(text);
  const source = responsibilities.length > 0
    ? responsibilities
    : text
        .split(/\r?\n|(?<=[.!?])\s+/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 12)
        .slice(0, MAX_REVIEW_REQUIREMENTS);

  return source
    .map((item, index) =>
      makeEvidence("job", `job.requirements[${index}]`, item, scopeKey),
    )
    .filter((item): item is AiEvidenceReference => item !== null);
}

function bestEvidenceIds(
  claim: string,
  evidence: AiEvidenceReference[],
  kind: EvidenceKind,
  limit = 4,
) {
  return evidence
    .filter((item) => item.kind === kind)
    .map((item) => ({ id: item.id, score: overlapScore(claim, item.excerpt) }))
    .filter((item) => item.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.id);
}

/**
 * A digit that follows a capitalised word is naming a product, not asserting a
 * result: "Microsoft 365", "Windows 11", "Power BI 2.0", "SQL Server 2019".
 * Treating those as quantified claims blocked a finalize over wording the
 * candidate had genuinely used, and a gate that cries wolf is one people learn
 * to click past — which costs more than the fabrications it would have caught.
 *
 * A model that invents a product the candidate never used is still caught, by
 * the skill and bullet evidence checks. This narrows only what counts as a
 * NUMBER.
 */
const PRODUCT_VERSION_RE = /\p{Lu}[\p{L}\p{N}.&-]*\s+$/u;

function numericClaims(text: string) {
  return Array.from(text.matchAll(NUMBER_CLAIM_RE))
    .filter((match) => {
      const numberStart = match.index + match[0].length - match[1].length;
      return !PRODUCT_VERSION_RE.test(text.slice(0, numberStart));
    })
    .map((match) => match[1]);
}

function reviewContentWithEvidence(
  aiContent: AiContent,
  evidence: AiEvidenceReference[],
): AiContent {
  const candidateEvidence = evidence.filter((item) => item.kind === "candidate");
  const jobEvidence = evidence.filter((item) => item.kind === "job");
  const summaryText = proposalText(aiContent.cv.summary);
  const summaryEvidenceIds = bestEvidenceIds(summaryText, evidence, "candidate", 8);
  const addedBullets = aiContent.cv.latestExperience.addedBullets.map((bullet) => ({
    ...bullet,
    evidenceIds: bestEvidenceIds(
      addedBulletText(bullet),
      evidence,
      "candidate",
      5,
    ),
  }));
  const cover = {
    paragraphOne: {
      ...aiContent.cover.paragraphOne,
      evidenceIds: bestEvidenceIds(
        proposalText(aiContent.cover.paragraphOne),
        evidence,
        "candidate",
        6,
      ),
    },
    paragraphTwo: {
      ...aiContent.cover.paragraphTwo,
      evidenceIds: bestEvidenceIds(
        proposalText(aiContent.cover.paragraphTwo),
        evidence,
        "candidate",
        6,
      ),
    },
    paragraphThree: {
      ...aiContent.cover.paragraphThree,
      evidenceIds: bestEvidenceIds(
        proposalText(aiContent.cover.paragraphThree),
        evidence,
        "candidate",
        6,
      ),
    },
  };

  const claims = [
    summaryText,
    ...acceptedAddedBulletTexts(addedBullets),
    ...coverParagraphTexts(cover),
  ].filter(Boolean);
  const combinedClaims = claims.join("\n");
  const candidateText = candidateEvidence.map((item) => item.excerpt).join("\n");

  const requirements = jobEvidence.slice(0, MAX_REVIEW_REQUIREMENTS).map((requirement) => {
    const score = overlapScore(requirement.excerpt, combinedClaims);
    return {
      id: stableId("req", requirement.contentHash),
      text: requirement.excerpt,
      status: score >= 0.45 ? "covered" as const : score >= 0.22 ? "partial" as const : "missing" as const,
      evidenceIds: bestEvidenceIds(requirement.excerpt, evidence, "candidate", 6),
    };
  });
  const coveragePoints = requirements.reduce(
    (sum, item) => sum + (item.status === "covered" ? 1 : item.status === "partial" ? 0.5 : 0),
    0,
  );
  const coveragePercent = requirements.length === 0
    ? 100
    : Math.round((coveragePoints / requirements.length) * 100);

  const issues: string[] = [];
  const ungroundedAcceptedBullets = addedBullets.filter(
    (bullet) => bullet.accepted && (bullet.evidenceIds?.length ?? 0) === 0,
  );
  if (ungroundedAcceptedBullets.length > 0) {
    issues.push(`${ungroundedAcceptedBullets.length} accepted CV bullet(s) lack candidate evidence.`);
  }
  const missingCount = requirements.filter((item) => item.status === "missing").length;
  if (missingCount > 0) {
    issues.push(`${missingCount} priority requirement(s) are not represented in the draft.`);
  }
  const unsupportedNumbers = new Set(
    claims
      .flatMap(numericClaims)
      .filter((number) => !candidateText.includes(number)),
  );
  if (unsupportedNumbers.size > 0) {
    issues.push(`Unsupported numeric claim(s): ${Array.from(unsupportedNumbers).slice(0, 6).join(", ")}.`);
  }

  const hasBlocker =
    ungroundedAcceptedBullets.length > 0 || unsupportedNumbers.size > 0;
  const review: AiApplicationReview = {
    verdict: hasBlocker ? "blocked" : coveragePercent < 67 ? "revise" : "pass",
    reviewedAt: new Date().toISOString(),
    coveragePercent,
    requirements,
    issues,
  };

  return {
    ...aiContent,
    evidence,
    review,
    cv: {
      ...aiContent.cv,
      summary: {
        ...aiContent.cv.summary,
        evidenceIds: summaryEvidenceIds,
      },
      latestExperience: {
        ...aiContent.cv.latestExperience,
        addedBullets,
      },
    },
    cover,
  };
}

/**
 * Re-evaluate user-edited content against the immutable evidence snapshot.
 * This prevents an edit from retaining a stale "pass" verdict or evidence
 * mapping that only matched the original model text.
 */
export function refreshEvidenceReview(aiContent: AiContent): AiContent {
  const evidence = [...(aiContent.evidence ?? [])];
  // With no evidence there is nothing to re-check, so a verdict carried over
  // from a previous edit would be a claim this content was reviewed when it
  // was not. Drop it instead.
  if (evidence.length === 0) {
    return aiContent.review ? { ...aiContent, review: undefined } : aiContent;
  }
  return reviewContentWithEvidence(aiContent, evidence);
}

export function attachEvidenceAndReview(input: EvidenceInput): AiContent {
  const scopeKey = input.scopeKey.trim();
  const evidence = [
    ...collectCandidateEvidence(input.resumeSnapshot, scopeKey),
    ...collectJobEvidence(input.jobDescription, scopeKey),
  ];
  return reviewContentWithEvidence({ ...input.aiContent, evidence }, evidence);
}

/**
 * Defense in depth for every ledger writer. Evidence identifiers are bound to
 * the authenticated tenant and the normalized, content-addressed excerpt.
 */
export function assertCanonicalEvidenceReferences(
  scopeKey: string,
  evidence: readonly AiEvidenceReference[],
) {
  for (const item of evidence) {
    const excerpt = normalize(item.excerpt).slice(0, MAX_EVIDENCE_EXCERPT);
    const contentHash = sha256(excerpt);
    const id = stableId("ev", `${scopeKey}\n${item.kind}\n${contentHash}`);
    if (
      excerpt.length < minimumEvidenceLength(item.kind, item.path) ||
      excerpt !== item.excerpt ||
      contentHash !== item.contentHash ||
      id !== item.id
    ) {
      throw new Error("INVALID_EVIDENCE_REFERENCE");
    }
  }
}

export const evidenceLedgerInternals = {
  normalize,
  overlapScore,
  tokens,
};
