import { describe, expect, it } from "vitest";
import {
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
      skillsAdditions: [],
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
      aiContent: draft,
      resumeSnapshot: { summary: "Improved platform throughput." },
      jobDescription: "Improve platform throughput and reliability.",
    });

    expect(reviewed.review?.verdict).toBe("blocked");
    expect(reviewed.review?.issues.join(" ")).toContain("700%");
  });

  it("maps supported skill additions to candidate evidence", () => {
    const draft = content();
    draft.cv.skillsAdditions = [
      { label: "Languages", items: ["TypeScript"], accepted: true },
    ];

    const reviewed = attachEvidenceAndReview({
      aiContent: draft,
      resumeSnapshot: {
        summary: "Backend engineer building secure APIs and AWS delivery pipelines.",
        skills: [{ label: "Languages", items: ["TypeScript"] }],
        experiences: [
          {
            bullets: [
              "Built secure TypeScript APIs and AWS deployment pipelines.",
            ],
          },
        ],
      },
      jobDescription: "Build secure TypeScript APIs.",
      scopeKey: "tenant-a",
    });

    const evidenceIds = reviewed.cv.skillsAdditions[0]?.evidenceIds ?? [];
    const candidateIds = new Set(
      reviewed.evidence
        ?.filter((item) => item.kind === "candidate")
        .map((item) => item.id),
    );
    expect(evidenceIds.length).toBeGreaterThan(0);
    expect(evidenceIds.every((id) => candidateIds.has(id))).toBe(true);
    expect(reviewed.review?.verdict).not.toBe("blocked");
  });

  it("blocks an accepted skill group when any item lacks candidate evidence", () => {
    const draft = content();
    draft.cv.skillsAdditions = [
      {
        label: "Platform",
        items: ["TypeScript", "Kubernetes"],
        accepted: true,
      },
    ];

    const reviewed = attachEvidenceAndReview({
      aiContent: draft,
      resumeSnapshot: {
        summary: "Backend engineer building secure APIs and AWS delivery pipelines.",
        skills: [{ label: "Languages", items: ["TypeScript"] }],
        experiences: [
          {
            bullets: [
              "Built secure TypeScript APIs and AWS deployment pipelines.",
            ],
          },
        ],
      },
      jobDescription: "Build secure TypeScript APIs.",
      scopeKey: "tenant-a",
    });

    expect(reviewed.review?.verdict).toBe("blocked");
    expect(reviewed.review?.issues.join(" ")).toContain("Kubernetes");
  });

  it("scopes evidence ids per tenant and revalidates user edits", () => {
    const base = {
      aiContent: content(),
      resumeSnapshot: { summary: "Built secure TypeScript APIs." },
      jobDescription: "Build secure TypeScript APIs.",
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
});
