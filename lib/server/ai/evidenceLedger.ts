import { createHash } from "node:crypto";
import { extractTopResponsibilities } from "@/lib/server/ai/responsibilityCoverage";
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
  scopeKey?: string;
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

function finalText(content: { aiText: string; userEdit?: string }) {
  return content.userEdit?.trim() || content.aiText.trim();
}

function numericClaims(text: string) {
  return Array.from(text.matchAll(NUMBER_CLAIM_RE), (match) => match[1]);
}

function reviewContentWithEvidence(
  aiContent: AiContent,
  evidence: AiEvidenceReference[],
): AiContent {
  const candidateEvidence = evidence.filter((item) => item.kind === "candidate");
  const jobEvidence = evidence.filter((item) => item.kind === "job");
  const summaryText = finalText(aiContent.cv.summary);
  const summaryEvidenceIds = bestEvidenceIds(summaryText, evidence, "candidate", 8);
  const addedBullets = aiContent.cv.latestExperience.addedBullets.map((bullet) => ({
    ...bullet,
    evidenceIds: bestEvidenceIds(
      bullet.userEdit?.trim() || bullet.text,
      evidence,
      "candidate",
      5,
    ),
  }));
  const cover = {
    paragraphOne: {
      ...aiContent.cover.paragraphOne,
      evidenceIds: bestEvidenceIds(
        finalText(aiContent.cover.paragraphOne),
        evidence,
        "candidate",
        6,
      ),
    },
    paragraphTwo: {
      ...aiContent.cover.paragraphTwo,
      evidenceIds: bestEvidenceIds(
        finalText(aiContent.cover.paragraphTwo),
        evidence,
        "candidate",
        6,
      ),
    },
    paragraphThree: {
      ...aiContent.cover.paragraphThree,
      evidenceIds: bestEvidenceIds(
        finalText(aiContent.cover.paragraphThree),
        evidence,
        "candidate",
        6,
      ),
    },
  };

  const claims = [
    summaryText,
    ...addedBullets
      .filter((bullet) => bullet.accepted)
      .map((bullet) => bullet.userEdit?.trim() || bullet.text),
    finalText(cover.paragraphOne),
    finalText(cover.paragraphTwo),
    finalText(cover.paragraphThree),
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
  return evidence.length === 0
    ? aiContent
    : reviewContentWithEvidence(aiContent, evidence);
}

export function attachEvidenceAndReview(input: EvidenceInput): AiContent {
  const scopeKey = input.scopeKey?.trim() || "anonymous";
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
