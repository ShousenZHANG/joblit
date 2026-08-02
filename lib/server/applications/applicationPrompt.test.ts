import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  getResumeProfile: vi.fn(),
  getRules: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: dependencies.jobFindFirst,
      findMany: dependencies.jobFindMany,
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

import {
  ApplicationPromptError,
  ApplicationPromptRequestSchema,
  MAX_APPLICATION_PROMPT_CHARS,
  TriagePromptRequestSchema,
  buildApplicationPromptForUser,
  buildTriagePromptForUser,
} from "@/lib/server/applications/applicationPrompt";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_JOB_ID = "660e8400-e29b-41d4-a716-446655440000";

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
  projects: [
    { name: "Joblit", dates: "2025", bullets: ["Built job matching"] },
  ],
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

function arrangeSuccess(
  overrides?: Partial<{
    description: string;
    jobUrl: string | null;
    market: "AU" | "CN";
  }>,
) {
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
}

describe("application prompt service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a strict public request schema", () => {
    expect(
      ApplicationPromptRequestSchema.safeParse({
        jobId: JOB_ID,
        target: "resume",
      }).success,
    ).toBe(true);
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
      expect(payload.prompt.input).toContain(
        "Build reliable distributed APIs.",
      );
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
      expect(payload.promptVersion).toBe("v4-application-proposal");
    },
  );

  it("binds prompt metadata to the full or lean prompt bytes", async () => {
    arrangeSuccess();
    const full = await buildApplicationPromptForUser({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "resume",
      variant: "full",
    });
    const lean = await buildApplicationPromptForUser({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "resume",
      variant: "lean",
    });

    expect(full.promptMeta.promptHash).not.toBe(lean.promptMeta.promptHash);
    expect(full.expectedJsonSchema).toEqual(lean.expectedJsonSchema);
    expect(full.prompt.input).not.toBe(lean.prompt.input);
  });

  it("accepts complete durable and claimToken-only v1 Fit handles", () => {
    const claimId = "77777777-7777-4777-8777-777777777777";
    const attemptId = "88888888-8888-4888-8888-888888888888";

    expect(
      TriagePromptRequestSchema.safeParse({ jobIds: [JOB_ID] }).success,
    ).toBe(true);
    expect(
      TriagePromptRequestSchema.safeParse({
        jobIds: [JOB_ID],
        claimToken: attemptId,
      }).success,
    ).toBe(true);
    expect(
      TriagePromptRequestSchema.safeParse({
        jobIds: [JOB_ID],
        claimId,
        claimToken: attemptId,
      }).success,
    ).toBe(true);
    expect(
      TriagePromptRequestSchema.safeParse({
        jobIds: [JOB_ID],
        attemptId,
      }).success,
    ).toBe(false);
    expect(
      TriagePromptRequestSchema.safeParse({
        jobIds: [JOB_ID],
        claimId,
      }).success,
    ).toBe(false);
    expect(
      TriagePromptRequestSchema.safeParse({
        jobIds: [JOB_ID],
        claimId,
        claimToken: attemptId,
        attemptId: "99999999-9999-4999-8999-999999999999",
      }).success,
    ).toBe(false);
  });

  it("issues one stable, non-secret Fit identity from authoritative prompt content", async () => {
    dependencies.jobFindMany.mockResolvedValue([
      {
        id: OTHER_JOB_ID,
        title: "Platform Engineer",
        company: "Beta",
        description: "Operate reliable Kubernetes platforms.",
        market: "AU",
      },
      {
        id: JOB_ID,
        title: "Backend Engineer",
        company: "Acme",
        description: "Build reliable distributed APIs.",
        market: "AU",
      },
    ]);
    dependencies.getResumeProfile.mockResolvedValue(profile);
    dependencies.getRules.mockResolvedValue(rules);

    const first = await buildTriagePromptForUser({
      userId: USER_ID,
      jobIds: [JOB_ID, OTHER_JOB_ID],
    });
    const afterRestart = await buildTriagePromptForUser({
      userId: USER_ID,
      jobIds: [OTHER_JOB_ID, JOB_ID],
    });

    expect(first.issueKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.prompt.sessionId).toBe(first.issueKey);
    expect(afterRestart.issueKey).toBe(first.issueKey);
    expect(afterRestart.prompt.sessionId).toBe(first.issueKey);
    expect(first.promptMeta.promptHash).toBe(
      afterRestart.promptMeta.promptHash,
    );
    expect(first.issueKey).not.toContain(USER_ID);
    expect(first.issueKey).not.toContain(JOB_ID);
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
      buildApplicationPromptForUser({
        userId: USER_ID,
        jobId: JOB_ID,
        target: "resume",
      }),
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });

    arrangeSuccess();
    dependencies.getResumeProfile.mockResolvedValueOnce(null);

    await expect(
      buildApplicationPromptForUser({
        userId: USER_ID,
        jobId: JOB_ID,
        target: "cover",
      }),
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
