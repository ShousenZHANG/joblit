import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  preflightFindFirst: vi.fn(),
  lockedFindFirst: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  evidenceCreateMany: vi.fn(),
  claimCreateMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    application: { findFirst: database.preflightFindFirst },
    $transaction: database.transaction,
  },
}));

import {
  autoSaveApplicationEdit,
  discardApplicationEdits,
} from "./applicationEdit";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "./applicationPublication";

const APPLICATION_ID = "11111111-1111-4111-9111-111111111111";
const USER_ID = "user-1";
const JOB_ID = "job-1";
const PROFILE_ID = "profile-1";

const PROFILE = {
  id: PROFILE_ID,
  userId: USER_ID,
  name: "Ada Lovelace",
  locale: "en-AU",
  summary: "Built reliable TypeScript APIs.",
  basics: null,
  links: null,
  skills: null,
  experiences: null,
  projects: null,
  education: null,
};

const JOB = {
  id: JOB_ID,
  userId: USER_ID,
  title: "Software Engineer",
  company: "Acme",
  description: "Build reliable TypeScript APIs for Australian customers.",
  market: "AU",
};

type PreflightFixture = {
  id: string;
  jobId: string | null;
  resumeProfileId: string | null;
  aiContentHash: string | null;
  resumeProfile: typeof PROFILE | null;
  job: typeof JOB | null;
};

type LockedApplicationFixture = {
  id: string;
  jobId: string | null;
  resumeProfileId: string | null;
  aiContent: unknown;
  aiContentHash: string | null;
  status: "DRAFT" | "FINAL";
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
  resumeContentHash: string | null;
  coverContentHash: string | null;
  resumePublishedHash: string | null;
  coverPublishedHash: string | null;
};

type LockedSourceFixture = {
  profileId: string;
  profileUserId: string;
  profileName: string;
  profileLocale: string;
  profileSummary: string | null;
  profileBasics: unknown;
  profileLinks: unknown;
  profileSkills: unknown;
  profileExperiences: unknown;
  profileProjects: unknown;
  profileEducation: unknown;
  jobId: string;
  jobUserId: string;
  jobTitle: string;
  jobCompany: string | null;
  jobDescription: string | null;
  jobMarket: string;
};

let preflightResult: PreflightFixture | null;
let lockedApplicationResult: LockedApplicationFixture | null;
let lockedSourceResult: LockedSourceFixture[];
let updateCount: number;
let transactionEffects: string[];
let transactionActive: boolean;
let updateObservedInsideTransaction: boolean;
let ledgerObservedInsideTransaction: boolean;

const transactionClient = {
  application: {
    findFirst: database.lockedFindFirst,
    updateMany: database.updateMany,
  },
  evidenceSnapshot: { createMany: database.evidenceCreateMany },
  claimEvidence: { createMany: database.claimCreateMany },
  $executeRaw: database.executeRaw,
  $queryRaw: database.queryRaw,
};

type TransactionAction = (
  tx: typeof transactionClient,
) => Promise<unknown>;

function makeAiContent(): AiContent {
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt: "2026-08-14T00:00:00.000Z",
    promptMetaHash: "prompt-1",
    cv: {
      summary: {
        aiText: "Built reliable TypeScript APIs.",
        originalText: "Original summary.",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [],
      },
    },
    cover: {
      paragraphOne: { aiText: "", accepted: false },
      paragraphTwo: { aiText: "", accepted: false },
      paragraphThree: { aiText: "", accepted: false },
    },
  };
}

function makeEditedAiContent(): AiContent {
  return {
    ...makeAiContent(),
    cv: {
      summary: {
        aiText: "Built reliable TypeScript APIs.",
        originalText: "Original summary.",
        userEdit: "User-edited summary.",
        accepted: false,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [
          {
            text: "Passed bullet",
            userEdit: "Edited passed bullet",
            accepted: false,
            qualityGate: { passed: true },
          },
          {
            text: "Failed bullet",
            userEdit: "Edited failed bullet",
            accepted: true,
            qualityGate: {
              passed: false,
              reason: "ungrounded: no JD evidence",
            },
          },
        ],
      },
    },
    cover: {
      paragraphOne: {
        aiText: "First paragraph",
        userEdit: "Edited first paragraph",
        accepted: false,
      },
      paragraphTwo: { aiText: "Second paragraph", accepted: true },
      paragraphThree: { aiText: "Third paragraph", accepted: true },
    },
  };
}

function makePreflight(
  aiContentHash: string | null,
  overrides: Partial<PreflightFixture> = {},
): PreflightFixture {
  return {
    id: APPLICATION_ID,
    jobId: JOB_ID,
    resumeProfileId: PROFILE_ID,
    aiContentHash,
    resumeProfile: PROFILE,
    job: JOB,
    ...overrides,
  };
}

function makeLockedApplication(
  aiContent: unknown,
  aiContentHash: string | null,
  overrides: Partial<LockedApplicationFixture> = {},
): LockedApplicationFixture {
  return {
    id: APPLICATION_ID,
    jobId: JOB_ID,
    resumeProfileId: PROFILE_ID,
    aiContent,
    aiContentHash,
    status: "DRAFT",
    resumePdfUrl: null,
    coverPdfUrl: null,
    resumeContentHash: null,
    coverContentHash: null,
    resumePublishedHash: null,
    coverPublishedHash: null,
    ...overrides,
  };
}

function makeLockedSource(
  overrides: Partial<LockedSourceFixture> = {},
): LockedSourceFixture {
  return {
    profileId: PROFILE.id,
    profileUserId: PROFILE.userId,
    profileName: PROFILE.name,
    profileLocale: PROFILE.locale,
    profileSummary: PROFILE.summary,
    profileBasics: PROFILE.basics,
    profileLinks: PROFILE.links,
    profileSkills: PROFILE.skills,
    profileExperiences: PROFILE.experiences,
    profileProjects: PROFILE.projects,
    profileEducation: PROFILE.education,
    jobId: JOB.id,
    jobUserId: JOB.userId,
    jobTitle: JOB.title,
    jobCompany: JOB.company,
    jobDescription: JOB.description,
    jobMarket: JOB.market,
    ...overrides,
  };
}

function arrangeApplication(aiContent: AiContent): string {
  const expectedHash = hashAiContent(aiContent);
  preflightResult = makePreflight(expectedHash);
  lockedApplicationResult = makeLockedApplication(aiContent, expectedHash);
  lockedSourceResult = [makeLockedSource()];
  return expectedHash;
}

describe("Application Edit interface", () => {
  beforeEach(() => {
    preflightResult = null;
    lockedApplicationResult = null;
    lockedSourceResult = [];
    updateCount = 1;
    transactionEffects = [];
    transactionActive = false;
    updateObservedInsideTransaction = false;
    ledgerObservedInsideTransaction = false;

    database.preflightFindFirst
      .mockReset()
      .mockImplementation(async () => preflightResult);
    database.lockedFindFirst.mockReset().mockImplementation(async () => {
      transactionEffects.push("application_read");
      return lockedApplicationResult;
    });
    database.executeRaw.mockReset().mockImplementation(async () => {
      transactionEffects.push("JOBA");
      return 1;
    });
    database.queryRaw.mockReset().mockImplementation(async () => {
      transactionEffects.push("source_lock");
      return lockedSourceResult;
    });
    database.updateMany.mockReset().mockImplementation(async () => {
      transactionEffects.push("application_update");
      updateObservedInsideTransaction = transactionActive;
      return { count: updateCount };
    });
    database.evidenceCreateMany.mockReset().mockImplementation(async () => {
      transactionEffects.push("evidence_ledger");
      ledgerObservedInsideTransaction = transactionActive;
      return { count: 1 };
    });
    database.claimCreateMany.mockReset().mockImplementation(async () => {
      transactionEffects.push("claim_ledger");
      ledgerObservedInsideTransaction = transactionActive;
      return { count: 1 };
    });
    database.transaction
      .mockReset()
      .mockImplementation(async (action: TransactionAction) => {
        transactionActive = true;
        try {
          return await action(transactionClient);
        } finally {
          transactionActive = false;
        }
      });
  });

  it("auto-saves only browser-owned decisions and rebuilds forged review data from locked sources", async () => {
    const stored = makeAiContent();
    const expectedHash = arrangeApplication(stored);
    const submitted = structuredClone(stored);
    submitted.cv.summary.aiText = "FORGED MODEL OUTPUT";
    submitted.cv.summary.userEdit = "Improved revenue by 999%.";
    submitted.evidence = [
      {
        id: `ev_${"f".repeat(32)}`,
        kind: "candidate",
        path: "resume.summary",
        contentHash: "f".repeat(64),
        excerpt: "Improved revenue by 999%.",
      },
    ];
    submitted.review = {
      verdict: "pass",
      reviewedAt: "2026-08-14T01:00:00.000Z",
      coveragePercent: 100,
      requirements: [],
      issues: [],
    };

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: submitted,
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.aiContent.cv.summary.aiText).toBe(
      stored.cv.summary.aiText,
    );
    expect(result.aiContent.cv.summary.userEdit).toBe(
      "Improved revenue by 999%.",
    );
    expect(result.aiContent.evidence).not.toEqual(submitted.evidence);
    expect(result.aiContent.evidence?.length).toBeGreaterThan(0);
    expect(result.aiContent.review?.verdict).toBe("blocked");
    expect(result.aiContent.review?.issues.join(" ")).toContain("999%");
    expect(result.aiContentHash).toBe(hashAiContent(result.aiContent));

    const update = database.updateMany.mock.calls[0]?.[0];
    expect(update.data.aiContent).toEqual(result.aiContent);
    expect(update.data.aiContentHash).toBe(result.aiContentHash);
    expect(database.evidenceCreateMany).toHaveBeenCalledOnce();
    expect(transactionEffects[0]).toBe("JOBA");
    expect(transactionEffects.indexOf("application_update")).toBeLessThan(
      transactionEffects.indexOf("evidence_ledger"),
    );
    expect(updateObservedInsideTransaction).toBe(true);
    expect(ledgerObservedInsideTransaction).toBe(true);
    expect(database.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 30_000 },
    );
  });

  it("keeps an untouched Cover FINAL when a Resume edit dirties only Resume", async () => {
    const stored = makeAiContent();
    stored.cover = {
      paragraphOne: { aiText: "First paragraph", accepted: true },
      paragraphTwo: { aiText: "Second paragraph", accepted: true },
      paragraphThree: { aiText: "Third paragraph", accepted: true },
    };
    const expectedHash = arrangeApplication(stored);
    const renderContext = buildApplicationPublicationRenderContext({
      profile: PROFILE,
      job: JOB,
    });
    const resumePublishedHash = hashApplicationDocumentContent(
      stored,
      "resume",
      renderContext,
    );
    const coverPublishedHash = hashApplicationDocumentContent(
      stored,
      "cover",
      renderContext,
    );
    expect(resumePublishedHash).not.toBeNull();
    expect(coverPublishedHash).not.toBeNull();
    lockedApplicationResult = makeLockedApplication(stored, expectedHash, {
      status: "FINAL",
      resumePdfUrl: "https://blob.example/resume.pdf",
      coverPdfUrl: "https://blob.example/cover.pdf",
      resumeContentHash: resumePublishedHash,
      coverContentHash: coverPublishedHash,
      resumePublishedHash,
      coverPublishedHash,
    });
    const submitted = structuredClone(stored);
    submitted.cv.summary.userEdit = "A user-edited Resume summary.";

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: submitted,
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.publication).toEqual({
      status: "DRAFT",
      resume: {
        status: "DRAFT",
        contentHash: expect.any(String),
        publishedHash: resumePublishedHash,
      },
      cover: {
        status: "FINAL",
        contentHash: coverPublishedHash,
        publishedHash: coverPublishedHash,
      },
    });
    expect(result.publication.resume.contentHash).not.toBe(resumePublishedHash);
    expect(database.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DRAFT",
          resumeContentHash: result.publication.resume.contentHash,
          resumePublishedHash,
          coverContentHash: coverPublishedHash,
          coverPublishedHash,
        }),
      }),
    );
  });

  it("discards edits and restores acceptance from replacement and quality-gate semantics", async () => {
    const edited = makeEditedAiContent();
    const expectedHash = arrangeApplication(edited);

    const result = await discardApplicationEdits({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.aiContent.cv.summary.userEdit).toBeUndefined();
    expect(result.aiContent.cv.summary.accepted).toBe(true);
    expect(
      result.aiContent.cv.latestExperience.addedBullets[0]?.userEdit,
    ).toBeUndefined();
    expect(
      result.aiContent.cv.latestExperience.addedBullets[0]?.accepted,
    ).toBe(true);
    expect(
      result.aiContent.cv.latestExperience.addedBullets[1]?.accepted,
    ).toBe(false);
    expect(result.aiContent.cover.paragraphOne.userEdit).toBeUndefined();
    expect(result.aiContent.cover.paragraphOne.accepted).toBe(true);
  });

  it("rejects an initial CAS mismatch before opening a transaction", async () => {
    preflightResult = makePreflight("current-hash");

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash: "stale-hash",
      submittedAiContent: makeAiContent(),
    });

    expect(result).toEqual({
      kind: "stale_write",
      currentHash: "current-hash",
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects a locked CAS mismatch before source locks or writes", async () => {
    const submitted = makeAiContent();
    const expectedHash = hashAiContent(submitted);
    preflightResult = makePreflight(expectedHash);
    lockedApplicationResult = makeLockedApplication(
      submitted,
      "newer-hash",
    );

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: submitted,
    });

    expect(result).toEqual({
      kind: "stale_write",
      currentHash: "newer-hash",
    });
    expect(transactionEffects).toEqual(["JOBA", "application_read"]);
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("reports a late CAS loss and does not append the review ledger", async () => {
    const current = makeAiContent();
    const expectedHash = arrangeApplication(current);
    updateCount = 0;

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: current,
    });

    expect(result).toEqual({ kind: "stale_write" });
    expect(database.updateMany).toHaveBeenCalledWith({
      where: {
        id: APPLICATION_ID,
        userId: USER_ID,
        jobId: JOB_ID,
        resumeProfileId: PROFILE_ID,
        aiContentHash: expectedHash,
      },
      data: expect.any(Object),
    });
    expect(database.evidenceCreateMany).not.toHaveBeenCalled();
    expect(database.claimCreateMany).not.toHaveBeenCalled();
  });

  it("returns not_found when an Auto-save Application disappears inside the transaction", async () => {
    const submitted = makeAiContent();
    const expectedHash = hashAiContent(submitted);
    preflightResult = makePreflight(expectedHash);
    lockedApplicationResult = null;

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: submitted,
    });

    expect(result).toEqual({ kind: "not_found" });
    expect(transactionEffects).toEqual(["JOBA", "application_read"]);
    expect(database.queryRaw).not.toHaveBeenCalled();
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("returns stale_write without a hash when a Discard Application disappears inside the transaction", async () => {
    const current = makeAiContent();
    const expectedHash = hashAiContent(current);
    preflightResult = makePreflight(expectedHash);
    lockedApplicationResult = null;

    const result = await discardApplicationEdits({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
    });

    expect(result).toEqual({ kind: "stale_write" });
    expect(result).not.toHaveProperty("currentHash");
    expect(transactionEffects).toEqual(["JOBA", "application_read"]);
    expect(database.queryRaw).not.toHaveBeenCalled();
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("treats a foreign or absent tenant Application as not found", async () => {
    preflightResult = null;

    const result = await discardApplicationEdits({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash: null,
    });

    expect(result).toEqual({ kind: "not_found" });
    expect(database.preflightFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APPLICATION_ID, userId: USER_ID },
      }),
    );
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["Job", { jobId: "job-2" }],
    ["Master Resume Profile", { resumeProfileId: "profile-2" }],
  ])("rejects a locked %s rebind", async (_label, rebind) => {
    const current = makeAiContent();
    const expectedHash = arrangeApplication(current);
    lockedApplicationResult = makeLockedApplication(
      current,
      expectedHash,
      rebind,
    );

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: current,
    });

    expect(result).toEqual({ kind: "stale_render_context" });
    expect(database.queryRaw).not.toHaveBeenCalled();
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a locked source mismatch when the Job description alone changed", async () => {
    const current = makeAiContent();
    const expectedHash = arrangeApplication(current);
    lockedSourceResult = [
      makeLockedSource({
        jobDescription: "A newer description requiring Rust.",
      }),
    ];
    database.queryRaw.mockImplementationOnce(
      async (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const sql = strings.join(" ");
        expect(sql).toContain(
          'job."description" AS "jobDescription"',
        );
        expect(sql).toContain('profile."id" AS "profileId"');
        expect(sql).toContain('job."id" AS "jobId"');
        expect(sql).toContain('FROM "Job" AS job');
        expect(sql).toContain('INNER JOIN "ResumeProfile" AS profile');
        expect(sql).toContain('profile."userId" =');
        expect(sql).toContain('job."userId" =');
        expect(sql).toContain("FOR SHARE OF job, profile");
        expect(parameters).toEqual([
          PROFILE_ID,
          USER_ID,
          JOB_ID,
          USER_ID,
        ]);
        transactionEffects.push("source_lock");
        return lockedSourceResult;
      },
    );

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: current,
    });

    expect(result).toEqual({ kind: "stale_render_context" });
    expect(database.queryRaw).toHaveBeenCalledOnce();
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("returns no_ai_content when discard has no stored AI Content", async () => {
    preflightResult = makePreflight(null);
    lockedApplicationResult = makeLockedApplication(null, null);

    const result = await discardApplicationEdits({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash: null,
    });

    expect(result).toEqual({ kind: "no_ai_content" });
    expect(database.queryRaw).not.toHaveBeenCalled();
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("treats missing stored AI Content as invalid for auto-save", async () => {
    preflightResult = makePreflight(null);
    lockedApplicationResult = makeLockedApplication(null, null);

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash: null,
      submittedAiContent: makeAiContent(),
    });

    expect(result).toEqual({ kind: "invalid_ai_content" });
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stored AI Content that fails the canonical schema", async () => {
    preflightResult = makePreflight("invalid-hash");
    lockedApplicationResult = makeLockedApplication(
      { wrong: true },
      "invalid-hash",
    );

    const result = await discardApplicationEdits({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash: "invalid-hash",
    });

    expect(result).toEqual({ kind: "invalid_ai_content" });
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when canonical review evidence has no owned Job source", async () => {
    const current = makeAiContent();
    const expectedHash = hashAiContent(current);
    preflightResult = makePreflight(expectedHash, { job: null });
    lockedApplicationResult = makeLockedApplication(current, expectedHash);

    const result = await autoSaveApplicationEdit({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      expectedHash,
      submittedAiContent: current,
    });

    expect(result).toEqual({ kind: "canonical_evidence_unavailable" });
    expect(database.queryRaw).not.toHaveBeenCalled();
    expect(database.updateMany).not.toHaveBeenCalled();
  });
});
