import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  jobUpdateMany: vi.fn(),
  getResumeProfile: vi.fn(),
  getRules: vi.fn(),
  fetchSeekDescription: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: dependencies.jobFindFirst,
      updateMany: dependencies.jobUpdateMany,
    },
  },
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: dependencies.getResumeProfile,
}));

vi.mock("@/lib/server/promptRuleTemplates", () => ({
  getActivePromptSkillRulesForUser: dependencies.getRules,
}));

vi.mock("@/lib/server/seek/fetchJobDescription", () => ({
  SEEK_THIN_DESCRIPTION: 800,
  isSeekJobUrl: (url: unknown) => typeof url === "string" && url.includes("seek.com"),
  fetchSeekJobDescription: dependencies.fetchSeekDescription,
}));

import {
  ApplicationPromptError,
  ApplicationPromptRequestSchema,
  MAX_APPLICATION_PROMPT_CHARS,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

const profile = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: USER_ID,
  name: "Master",
  revision: 7,
  locale: "en-AU",
  summary: "Backend engineer focused on C++ & APIs_100%.",
  basics: {
    fullName: "Alex Chen",
    title: "Backend Engineer",
    email: "candidate@example.com",
    phone: "+61 400 000 000",
    photoUrl: "https://private.example/photo.jpg",
  },
  links: [{ label: "LinkedIn", url: "https://linkedin.example/alex" }],
  skills: [{ category: "Backend", items: ["TypeScript", "Node.js"] }],
  experiences: [
    {
      title: "Backend Engineer",
      company: "Example Co",
      dates: "2023-present",
      bullets: ["Built C++ APIs_100% & reduced latency."],
      links: [{ label: "Private", url: "https://private.example/work" }],
    },
  ],
  projects: [{ name: "Joblit", dates: "2025", bullets: ["Built job matching"] }],
  education: [{ school: "Example University", degree: "BSc", dates: "2022" }],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-15T00:00:00.000Z"),
};

const rules = {
  id: "rules-1",
  locale: "en-AU" as const,
  cvRules: ["Keep resume grounded."],
  coverRules: ["Keep cover grounded."],
  hardConstraints: ["Return strict JSON only."],
};

function arrangeSuccess(overrides?: Partial<{
  description: string;
  jobUrl: string | null;
  market: "AU" | "CN";
}>) {
  dependencies.jobFindFirst.mockResolvedValue({
    title: "Senior Backend Engineer",
    company: "Acme",
    description: overrides?.description ?? "Build reliable distributed APIs.",
    market: overrides?.market ?? "AU",
    jobUrl: overrides?.jobUrl ?? "https://jobs.example/1",
  });
  dependencies.getResumeProfile.mockResolvedValue(profile);
  dependencies.getRules.mockResolvedValue(rules);
  dependencies.jobUpdateMany.mockResolvedValue({ count: 1 });
  dependencies.fetchSeekDescription.mockResolvedValue(null);
}

describe("application prompt service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a strict public request schema", () => {
    expect(ApplicationPromptRequestSchema.safeParse({ jobId: JOB_ID, target: "resume" }).success).toBe(
      true,
    );
    expect(
      ApplicationPromptRequestSchema.safeParse({
        jobId: JOB_ID,
        target: "resume",
        userId: USER_ID,
      }).success,
    ).toBe(false);
  });

  it.each(["resume", "cover"] as const)(
    "builds an auth-agnostic self-contained %s payload",
    async (target) => {
      arrangeSuccess();

      const payload = await buildApplicationPromptForUser({
        userId: USER_ID,
        jobId: JOB_ID,
        target,
      });

      expect(dependencies.jobFindFirst).toHaveBeenCalledWith({
        where: { id: JOB_ID, userId: USER_ID },
        select: {
          title: true,
          company: true,
          description: true,
          market: true,
          jobUrl: true,
        },
      });
      expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(payload.prompt.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(payload.prompt.instructions).toContain("<untrusted-data-policy>");
      expect(payload.prompt.input).toContain("<candidate-evidence>");
      expect(payload.prompt.input).toContain("<job-evidence>");
      expect(payload.prompt.input).toContain("Alex Chen");
      expect(payload.prompt.input).toContain("Build reliable distributed APIs.");
      expect(payload.prompt.input).toContain("C++ & APIs_100%");
      expect(payload.prompt.input).not.toContain("candidate@example.com");
      expect(payload.prompt.input).not.toContain("+61 400 000 000");
      expect(payload.prompt.input).not.toContain("https://private.example");
      expect(payload.prompt.input).not.toContain("C++ \\& APIs\\_100\\%");
      expect(payload.prompt.input).not.toContain("resume-snapshot.json");
      expect(typeof payload.expectedJsonShape).toBe("string");
      expect(JSON.parse(payload.expectedJsonShape)).toEqual(
        target === "resume"
          ? expect.objectContaining({ cvSummary: "string" })
          : expect.objectContaining({ cover: expect.any(Object) }),
      );
      expect(payload.expectedJsonSchema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
      });
      expect(payload.promptMeta).toMatchObject({
        ruleSetId: "rules-1",
        resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
      });
      expect(payload.promptVersion).toBe("v3-local-ai");
    },
  );

  it("upgrades and persists a thin Seek description before coverage and prompt construction", async () => {
    arrangeSuccess({
      description: "Thin teaser",
      jobUrl: "https://www.seek.com.au/job/123",
    });
    dependencies.fetchSeekDescription.mockResolvedValue(
      "Full Seek description with distributed systems ownership.",
    );

    const payload = await buildApplicationPromptForUser({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "resume",
    });

    expect(payload.prompt.input).toContain(
      "Full Seek description with distributed systems ownership.",
    );
    expect(dependencies.jobUpdateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, userId: USER_ID },
      data: { description: "Full Seek description with distributed systems ownership." },
    });
  });

  it("rejects invalid service input before database access", async () => {
    await expect(
      buildApplicationPromptForUser({
        userId: USER_ID,
        jobId: "not-a-uuid",
        target: "resume",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    expect(dependencies.jobFindFirst).not.toHaveBeenCalled();
  });

  it("returns typed not-found errors for missing jobs and profiles", async () => {
    dependencies.jobFindFirst.mockResolvedValueOnce(null);

    await expect(
      buildApplicationPromptForUser({ userId: USER_ID, jobId: JOB_ID, target: "resume" }),
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });

    arrangeSuccess();
    dependencies.getResumeProfile.mockResolvedValueOnce(null);

    await expect(
      buildApplicationPromptForUser({ userId: USER_ID, jobId: JOB_ID, target: "cover" }),
    ).rejects.toMatchObject({ code: "NO_PROFILE", status: 404 });
  });

  it.each([
    ["AU", "Application prompt is too large to process."],
    ["CN", "申请提示内容过长，无法处理。"],
  ] as const)(
    "returns a stable localized PROMPT_TOO_LARGE contract for %s jobs",
    async (market, expectedMessage) => {
    arrangeSuccess({ market });
    dependencies.getRules.mockResolvedValueOnce({
      ...rules,
      hardConstraints: ["x".repeat(MAX_APPLICATION_PROMPT_CHARS + 1)],
    });

    const error = await buildApplicationPromptForUser({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "resume",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApplicationPromptError);
    expect(error).toMatchObject({
      code: "PROMPT_TOO_LARGE",
      status: 413,
      message: expectedMessage,
    });
    },
  );
});
