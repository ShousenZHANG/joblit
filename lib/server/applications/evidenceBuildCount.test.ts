import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The evidence ledger must be built exactly once per request, over the merged
 * snapshot that will actually be persisted.
 *
 * It used to run twice on the manual-import path and three times on the server
 * batch path, and every result but the last was discarded. That was not only
 * wasted work — each build reflectively walks the whole Master Resume Profile —
 * it meant `acceptApplicationGeneration` produced a review of ONE target in
 * isolation, with the other target's paragraphs still empty. The manual-generate
 * route then gated finalize on that partial review while
 * `commitApplicationArtifact` gated on the merged one, so two different
 * snapshots could answer the same grounding question.
 *
 * These counts are the invariant. If a build reappears in the acceptance seam,
 * this fails.
 */

const counter = vi.hoisted(() => ({ builds: 0 }));

vi.mock("@/lib/server/ai/evidenceLedger", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/ai/evidenceLedger")>();
  return {
    ...actual,
    attachEvidenceAndReview: (
      ...args: Parameters<typeof actual.attachEvidenceAndReview>
    ) => {
      counter.builds += 1;
      return actual.attachEvidenceAndReview(...args);
    },
  };
});

import { acceptApplicationGeneration } from "./applicationGeneration";
import { evolveApplicationAiContent } from "./applicationAiContentAggregate";

const USER_ID = "user-1";

const PROFILE = {
  locale: "en-AU",
  summary: "Backend engineer building secure TypeScript APIs on AWS.",
  experiences: [
    {
      company: "Acme",
      title: "Engineer",
      bullets: ["Built secure TypeScript APIs and AWS deployment pipelines."],
    },
  ],
  skills: [{ name: "TypeScript" }, { name: "AWS" }],
};

const MASTER = {
  candidate: { name: "Sam", title: "Engineer" },
  summary: "Backend engineer building secure TypeScript APIs on AWS.",
  experiences: [
    {
      company: "Acme",
      title: "Engineer",
      bullets: ["Built secure TypeScript APIs and AWS deployment pipelines."],
    },
  ],
  skills: [{ name: "TypeScript" }],
} as never;

const JOB = {
  id: "job-1",
  title: "Platform Engineer",
  company: "Globex",
  description:
    "Responsibilities:\n- Build secure TypeScript APIs\n- Own AWS delivery pipelines",
  market: "AU",
};

function acceptResume() {
  return acceptApplicationGeneration({
    evidenceScopeKey: USER_ID,
    target: "resume",
    source: "manual_import",
    rawOutput: JSON.stringify({
      cvSummary: "Backend engineer building secure TypeScript APIs on AWS.",
      latestExperience: {
        addedBullets: ["Owned AWS delivery pipelines for secure TypeScript APIs."],
      },
    }),
    promptMetaHash: "hash",
    master: MASTER,
    profile: PROFILE,
    job: JOB,
  });
}

describe("evidence ledger build count", () => {
  beforeEach(() => {
    counter.builds = 0;
  });

  it("does not build evidence inside the acceptance seam", () => {
    const accepted = acceptResume();
    expect(accepted.ok).toBe(true);
    expect(counter.builds).toBe(0);
  });

  it("leaves the acceptance result without a review to be read too early", () => {
    // A review of one target in isolation is not the review of the document
    // that gets persisted; exposing one invites a caller to gate on it.
    const accepted = acceptResume();
    if (!accepted.ok) throw new Error("fixture should be accepted");
    expect(accepted.aiContent.review).toBeUndefined();
    expect(accepted.aiContent.evidence).toBeUndefined();
  });

  it("builds exactly once when the proposal is merged", () => {
    const accepted = acceptResume();
    if (!accepted.ok) throw new Error("fixture should be accepted");
    counter.builds = 0;

    const evolved = evolveApplicationAiContent({
      current: null,
      command: {
        kind: "replace_target_proposal",
        target: "resume",
        proposal: accepted.aiContent,
      },
      reviewContext: {
        scopeKey: USER_ID,
        resumeSnapshot: { profile: PROFILE, renderInput: MASTER },
        jobDescription: JOB.description,
        jobSourceAvailable: true,
      },
    });

    expect(evolved.kind).toBe("evolved");
    expect(counter.builds).toBe(1);
  });

  it("still produces a review and evidence on the merged snapshot", () => {
    const accepted = acceptResume();
    if (!accepted.ok) throw new Error("fixture should be accepted");

    const evolved = evolveApplicationAiContent({
      current: null,
      command: {
        kind: "replace_target_proposal",
        target: "resume",
        proposal: accepted.aiContent,
      },
      reviewContext: {
        scopeKey: USER_ID,
        resumeSnapshot: { profile: PROFILE, renderInput: MASTER },
        jobDescription: JOB.description,
        jobSourceAvailable: true,
      },
    });
    if (evolved.kind !== "evolved") throw new Error("expected an evolved result");

    expect(evolved.aiContent.review).toBeDefined();
    expect(evolved.aiContent.evidence?.length).toBeGreaterThan(0);
  });
});
