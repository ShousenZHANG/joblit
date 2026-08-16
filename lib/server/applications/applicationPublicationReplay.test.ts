import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "./applicationPublication";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

const application = vi.hoisted(() => ({ findFirst: vi.fn() }));
const database = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
}));
const tailoringPublication = vi.hoisted(() => ({
  prepare: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: database.transaction },
}));

import { confirmApplicationPublicationReplay } from "./applicationPublicationReplay";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const APPLICATION_ID = "44444444-4444-4444-8444-444444444444";
const PROFILE = {
  summary: "Profile summary",
  basics: {
    fullName: "Ada Lovelace",
    title: "Engineer",
    email: "ada@example.com",
    phone: "+61 400 000 000",
  },
  links: null,
  skills: [{ category: "Core", items: ["TypeScript"] }],
  experiences: null,
  projects: null,
  education: null,
};
const JOB = {
  title: "Engineer",
  company: "Joblit",
  market: "AU",
};
const RENDER_CONTEXT = buildApplicationPublicationRenderContext({
  profile: PROFILE,
  job: JOB,
});
const AI_CONTENT: AiContent = {
  schemaVersion: AI_CONTENT_SCHEMA_VERSION,
  generatedAt: "2026-07-28T00:00:00.000Z",
  promptMetaHash: "prompt-hash",
  cv: {
    summary: {
      aiText: "Tailored summary",
      originalText: "Profile summary",
      accepted: true,
    },
    skillsSelection: { aiSelection: [{ group: 0, items: [0] }] },
  },
  cover: {
    paragraphOne: { aiText: "", accepted: false },
    paragraphTwo: { aiText: "", accepted: false },
    paragraphThree: { aiText: "", accepted: false },
  },
};
const AI_CONTENT_HASH = hashAiContent(AI_CONTENT);
const RESUME_CONTENT_HASH = hashApplicationDocumentContent(
  AI_CONTENT,
  "resume",
  RENDER_CONTEXT,
);

function lockedRenderSource(profileBasics: unknown = PROFILE.basics) {
  return {
    profileSummary: PROFILE.summary,
    profileBasics,
    profileLinks: PROFILE.links,
    profileSkills: PROFILE.skills,
    profileExperiences: PROFILE.experiences,
    profileProjects: PROFILE.projects,
    profileEducation: PROFILE.education,
    jobTitle: JOB.title,
    jobCompany: JOB.company,
    jobMarket: JOB.market,
  };
}

function currentApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    jobId: JOB_ID,
    resumeProfileId: PROFILE_ID,
    status: "FINAL",
    aiContent: AI_CONTENT,
    aiContentHash: AI_CONTENT_HASH,
    resumePdfUrl: "https://blob.example/current-resume.pdf",
    resumePdfName: "Ada Lovelace Engineer_CV.pdf",
    coverPdfUrl: null,
    resumeContentHash: RESUME_CONTENT_HASH,
    resumePublishedHash: RESUME_CONTENT_HASH,
    coverContentHash: null,
    coverPublishedHash: null,
    ...overrides,
  };
}

const INPUT = {
  userId: USER_ID,
  applicationId: APPLICATION_ID,
  jobId: JOB_ID,
  resumeProfileId: PROFILE_ID,
  expectedHash: AI_CONTENT_HASH,
  target: "resume" as const,
  renderContext: RENDER_CONTEXT,
};

beforeEach(() => {
  vi.clearAllMocks();
  application.findFirst.mockResolvedValue(currentApplication());
  database.queryRaw.mockResolvedValue([lockedRenderSource()]);
  database.executeRaw.mockResolvedValue(0);
  database.transaction.mockImplementation((callback) =>
    callback({
      application,
      $queryRaw: database.queryRaw,
      $executeRaw: database.executeRaw,
    }),
  );
});

describe("confirmApplicationPublicationReplay", () => {
  it("returns a replay only after CAS and target-scoped source fencing", async () => {
    const result = await confirmApplicationPublicationReplay(INPUT);

    expect(result).toMatchObject({
      kind: "replayed",
      aiContentHash: AI_CONTENT_HASH,
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      publication: {
        status: "FINAL",
        resume: { status: "FINAL" },
      },
    });
    expect(database.executeRaw).toHaveBeenCalledOnce();
    expect(database.queryRaw).toHaveBeenCalledOnce();
  });

  it("rejects the fast replay when Profile inputs changed after the initial read", async () => {
    database.queryRaw.mockResolvedValueOnce([
      lockedRenderSource({
        ...PROFILE.basics,
        fullName: "Grace Hopper",
      }),
    ]);

    const result = await confirmApplicationPublicationReplay(INPUT);

    expect(result).toEqual({ kind: "stale_render_context" });
  });

  it("rejects a replay after the Application is rebound to another Profile", async () => {
    application.findFirst.mockResolvedValueOnce(
      currentApplication({
        resumeProfileId: "55555555-5555-4555-8555-555555555555",
      }),
    );

    const result = await confirmApplicationPublicationReplay(INPUT);

    expect(result).toEqual({ kind: "stale_render_context" });
    expect(database.queryRaw).not.toHaveBeenCalled();
  });

  it("reprojects the untouched target from the latest locked context", async () => {
    const aiContentWithCover: AiContent = {
      ...AI_CONTENT,
      cover: {
        paragraphOne: { aiText: "One", accepted: true },
        paragraphTwo: { aiText: "Two", accepted: true },
        paragraphThree: { aiText: "Three", accepted: true },
      },
    };
    const aiContentHash = hashAiContent(aiContentWithCover);
    const resumeContentHash = hashApplicationDocumentContent(
      aiContentWithCover,
      "resume",
      RENDER_CONTEXT,
    );
    const coverContentHash = hashApplicationDocumentContent(
      aiContentWithCover,
      "cover",
      RENDER_CONTEXT,
    );
    application.findFirst.mockResolvedValueOnce(
      currentApplication({
        aiContent: aiContentWithCover,
        aiContentHash,
        resumeContentHash,
        resumePublishedHash: resumeContentHash,
        coverPdfUrl: "https://blob.example/current-cover.pdf",
        coverContentHash,
        coverPublishedHash: coverContentHash,
      }),
    );
    database.queryRaw.mockResolvedValueOnce([
      {
        ...lockedRenderSource(),
        jobTitle: "Principal Engineer",
      },
    ]);

    const result = await confirmApplicationPublicationReplay({
      ...INPUT,
      expectedHash: aiContentHash,
      target: "resume",
    });

    expect(result).toMatchObject({
      kind: "replayed",
      publication: {
        status: "DRAFT",
        resume: { status: "FINAL" },
        cover: { status: "DRAFT" },
      },
    });
  });

  it("falls through to rendering when the locked Application is no longer Final", async () => {
    application.findFirst.mockResolvedValueOnce(
      currentApplication({ resumePublishedHash: "previous-content" }),
    );

    const result = await confirmApplicationPublicationReplay(INPUT);

    expect(result).toEqual({ kind: "render_required" });
  });

  it("re-renders a legacy row that has no non-null client CAS baseline", async () => {
    application.findFirst.mockResolvedValueOnce(
      currentApplication({ aiContentHash: null }),
    );

    const result = await confirmApplicationPublicationReplay({
      ...INPUT,
      expectedHash: null,
    });

    expect(result).toEqual({ kind: "render_required" });
  });
});
