import { describe, expect, it } from "vitest";
import {
  assertCanonicalEvidenceReferences,
  attachEvidenceAndReview,
  evidenceLedgerInternals,
  refreshEvidenceReview,
} from "./evidenceLedger";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

function content(overrides?: Partial<AiContent>): AiContent {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-20T00:00:00.000Z",
    promptMetaHash: "prompt",
    source: "local_ai",
    cv: {
      summary: {
        aiText: "Backend engineer building secure APIs and AWS delivery pipelines.",
        originalText: "Backend engineer.",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [
          {
            text: "Built secure TypeScript APIs and AWS deployment pipelines.",
            accepted: true,
            qualityGate: { passed: true },
          },
        ],
      },
    },
    cover: {
      paragraphOne: { aiText: "I build secure TypeScript APIs.", accepted: true },
      paragraphTwo: { aiText: "My AWS delivery work fits this role.", accepted: true },
      paragraphThree: { aiText: "I can contribute to reliable platforms.", accepted: true },
    },
    ...overrides,
  };
}

describe("evidence ledger", () => {
  it("creates stable evidence ids and a deterministic requirement ledger", () => {
    const input = {
      aiContent: content(),
      resumeSnapshot: {
        summary: "Backend engineer building secure APIs.",
        experiences: [
          {
            bullets: [
              "Built secure TypeScript APIs and AWS deployment pipelines.",
            ],
          },
        ],
      },
      jobDescription:
        "Responsibilities:\n- Build secure TypeScript APIs\n- Own AWS delivery pipelines",
      scopeKey: "user-1",
    };

    const first = attachEvidenceAndReview(input);
    const second = attachEvidenceAndReview(input);

    expect(first.evidence?.map((item) => item.id)).toEqual(
      second.evidence?.map((item) => item.id),
    );
    expect(first.cv.latestExperience.addedBullets[0].evidenceIds?.length).toBeGreaterThan(0);
    expect(first.review?.requirements.length).toBeGreaterThan(0);
    expect(first.review?.coveragePercent).toBeGreaterThanOrEqual(50);
  });

  it("blocks unsupported numeric claims", () => {
    const draft = content();
    draft.cv.summary.aiText = "Improved platform throughput by 700%.";

    const reviewed = attachEvidenceAndReview({
      scopeKey: "user-1",
      aiContent: draft,
      resumeSnapshot: { summary: "Improved platform throughput." },
      jobDescription: "Improve platform throughput and reliability.",
    });

    expect(reviewed.review?.verdict).toBe("blocked");
    expect(reviewed.review?.issues.join(" ")).toContain("700%");
  });

  it("does not read a digit inside a product name as a quantified claim", () => {
    // "Microsoft 365", "Windows 11", "Power BI 2.0" — the number names the
    // product, it does not assert a result. Flagging these blocked a finalize
    // over a word the candidate had actually written, and a gate that cries
    // wolf teaches people to click past it.
    const draft = content();
    draft.cv.summary.aiText =
      "Automation specialist delivering solutions across Power Platform, Dataverse and Microsoft 365.";

    const reviewed = attachEvidenceAndReview({
      scopeKey: "user-1",
      aiContent: draft,
      // The master profile names the suite without the version, so no "365"
      // appears anywhere in the candidate evidence.
      resumeSnapshot: {
        summary: "Automation specialist working across Power Platform.",
      },
      jobDescription: "Build automation across Microsoft 365.",
    });

    expect(reviewed.review?.issues.join(" ")).not.toContain("365");
  });

  it("still blocks a bare number the candidate never claimed", () => {
    // The product-name exemption must not become a hole: a standalone figure
    // is exactly the fabrication this gate exists to catch.
    const draft = content();
    draft.cv.summary.aiText = "Automation specialist supporting 4200 users.";

    const reviewed = attachEvidenceAndReview({
      scopeKey: "user-1",
      aiContent: draft,
      resumeSnapshot: { summary: "Automation specialist supporting users." },
      jobDescription: "Support users.",
    });

    expect(reviewed.review?.verdict).toBe("blocked");
    expect(reviewed.review?.issues.join(" ")).toContain("4200");
  });

  it("scopes evidence ids per tenant and revalidates user edits", () => {
    const base = {
      aiContent: content(),
      resumeSnapshot: { summary: "Built secure TypeScript APIs." },
      jobDescription: "Build secure TypeScript APIs.",
      scopeKey: "user-1",
    };
    const tenantA = attachEvidenceAndReview({ ...base, scopeKey: "tenant-a" });
    const tenantB = attachEvidenceAndReview({ ...base, scopeKey: "tenant-b" });
    expect(tenantA.evidence?.[0]?.id).not.toBe(tenantB.evidence?.[0]?.id);

    tenantA.cv.summary.userEdit = "Increased revenue by 999%.";
    const refreshed = refreshEvidenceReview(tenantA);
    expect(refreshed.review?.verdict).toBe("blocked");
    expect(refreshed.review?.issues.join(" ")).toContain("999%");
  });

  it("uses CJK character n-grams instead of collapsing Chinese text", () => {
    const score = evidenceLedgerInternals.overlapScore(
      "负责后端平台与接口开发",
      "设计后端平台并开发安全接口",
    );
    expect(score).toBeGreaterThan(0.2);
    expect(evidenceLedgerInternals.tokens("后端平台")).toEqual(
      new Set(["后端", "端平", "平台"]),
    );
  });

  it("drops a verdict it cannot re-derive rather than carrying it forward", () => {
    // With no evidence there is nothing to re-check, so keeping the previous
    // review would assert this content was reviewed when it was not. The old
    // behaviour returned the input untouched, so a draft that lost its evidence
    // kept a stale "pass" forever.
    const withoutEvidence = {
      schemaVersion: 1 as const,
      generatedAt: "2026-07-23T00:00:00.000Z",
      promptMetaHash: "p1",
      evidence: [],
      review: {
        verdict: "pass" as const,
        reviewedAt: "2026-07-23T00:00:00.000Z",
        coveragePercent: 100,
        requirements: [],
        issues: [],
      },
      cv: {
        summary: { aiText: "ai", originalText: "orig", accepted: true },
        latestExperience: { experienceIndex: 0, addedBullets: [] },
      },
      cover: {
        paragraphOne: { aiText: "One", accepted: true },
        paragraphTwo: { aiText: "Two", accepted: true },
        paragraphThree: { aiText: "Three", accepted: true },
      },
    };

    expect(refreshEvidenceReview(withoutEvidence).review).toBeUndefined();
  });
});

/**
 * Every excerpt this module mints is later re-validated by
 * assertCanonicalEvidenceReferences, which re-runs normalize() and demands
 * byte equality. normalize() ends in .trim(), so an excerpt truncated on a
 * whitespace boundary could never validate — and the validator throws a bare
 * Error from inside the commit transaction, which reaches an agent client as
 * an anonymous 500 and gets replayed forever. A permanent, unrecoverable stall
 * decided by where the 480th character of a job description happens to fall.
 */
describe("evidence excerpts survive their own validator", () => {
  function longTextTruncatingOn(charIndex: number, boundary: string): string {
    // Build text whose normalized form has `boundary` exactly at charIndex,
    // and which is comfortably longer than the excerpt cap.
    const head = "responsibility ".repeat(200).slice(0, charIndex);
    return `${head}${boundary}${"trailing detail ".repeat(60)}`;
  }

  it("accepts an excerpt truncated on a space", () => {
    const jobDescription = longTextTruncatingOn(479, " ");
    const reviewed = attachEvidenceAndReview({
      aiContent: content(),
      resumeSnapshot: { summary: "Backend engineer building secure APIs." },
      jobDescription,
      scopeKey: "user-1",
    });

    expect(reviewed.evidence?.length).toBeGreaterThan(0);
    expect(() =>
      assertCanonicalEvidenceReferences("user-1", reviewed.evidence ?? []),
    ).not.toThrow();
  });

  it("accepts excerpts truncated at every boundary near the cap", () => {
    // One unlucky offset is enough to wedge a user permanently, so sweep the
    // window rather than trusting a single sample.
    for (let offset = 470; offset <= 490; offset += 1) {
      const jobDescription = longTextTruncatingOn(offset, " ");
      const reviewed = attachEvidenceAndReview({
        aiContent: content(),
        resumeSnapshot: { summary: "Backend engineer building secure APIs." },
        jobDescription,
        scopeKey: "user-1",
      });
      expect(
        () => assertCanonicalEvidenceReferences("user-1", reviewed.evidence ?? []),
        `offset ${offset}`,
      ).not.toThrow();
    }
  });
});
