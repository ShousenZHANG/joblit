import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

const tailorApplicationContent = vi.hoisted(() =>
  vi.fn(async () => ({
    cvSummary: "Tailored summary",
    cover: {
      paragraphOne: "One",
      paragraphTwo: "Two",
      paragraphThree: "Three",
    },
    source: { cv: "ai", cover: "ai" },
    reason: "ai_ok",
    // Keep the mock return shape flexible so per-test overrides can include quality gate details.
    qualityReport: { passed: true, issues: [] as Array<{ code: string; message: string }> },
  })),
);

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
    application: applicationStore,
    resumeProfile: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: vi.fn(),
}));

vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: vi.fn(() => ({
    candidate: {
      name: "Jane Doe",
      title: "Software Engineer",
      email: "jane@example.com",
      phone: "+1 555 0100",
      linkedinUrl: "https://linkedin.com/in/jane",
      linkedinText: "linkedin.com/in/jane",
    },
    summary: "Summary",
    skills: [],
    experiences: [],
    projects: [],
    education: [],
  })),
}));

vi.mock("@/lib/server/latex/renderCoverLetter", () => ({
  renderCoverLetterTex: vi.fn(() => "\\documentclass{article}"),
}));

vi.mock("@/lib/server/latex/compilePdf", () => ({
  LatexRenderError: class LatexRenderError extends Error {
    constructor(
      public code: string,
      public status: number,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  },
  compileLatexToPdf: vi.fn(async () => Buffer.from([37, 80, 68, 70])),
}));

vi.mock("@/lib/server/ai/tailorApplication", () => ({
  tailorApplicationContent,
}));

import { getServerSession } from "next-auth/next";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { POST } from "@/app/api/applications/generate-cover-letter/route";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("applications generate cover letter api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReset();
    jobStore.findFirst.mockReset();
    applicationStore.upsert.mockReset();
    tailorApplicationContent.mockClear();
  });

  it("returns 404 when job does not exist", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://localhost/api/applications/generate-cover-letter", {
        method: "POST",
        body: JSON.stringify({ jobId: VALID_JOB_ID }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.code).toBe("JOB_NOT_FOUND");
  });

  it("generates a cover letter pdf and upserts application", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      userId: "user-1",
      basics: {
        fullName: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Summary",
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });
    applicationStore.upsert.mockResolvedValueOnce({
      id: "app-1",
    });

    const res = await POST(
      new Request("http://localhost/api/applications/generate-cover-letter", {
        method: "POST",
        body: JSON.stringify({ jobId: VALID_JOB_ID }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("_CL.pdf");
    expect(res.headers.get("x-application-id")).toBe("app-1");
    expect(applicationStore.upsert).toHaveBeenCalled();
    expect(tailorApplicationContent).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSnapshot: expect.objectContaining({
          id: "rp-1",
          summary: "Summary",
        }),
      }),
      expect.objectContaining({
        strictCoverQuality: true,
        maxCoverRewritePasses: 2,
      }),
    );
  });

  it("uses zh-CN resume profile and locale profile for CN jobs", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "前端工程师",
      company: "示例科技",
      description: "负责前端产品开发",
      market: "CN",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-cn",
      userId: "user-1",
      locale: "zh-CN",
      basics: {
        fullName: "张三",
        title: "前端工程师",
        email: "zhangsan@example.com",
        phone: "13800000000",
      },
      summary: "中文简历摘要",
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });
    applicationStore.upsert.mockResolvedValueOnce({
      id: "app-cn",
    });

    const res = await POST(
      new Request("http://localhost/api/applications/generate-cover-letter", {
        method: "POST",
        body: JSON.stringify({ jobId: VALID_JOB_ID }),
      }),
    );

    expect(res.status).toBe(200);
    expect(getResumeProfile).toHaveBeenCalledWith("user-1", { locale: "zh-CN" });
    expect(tailorApplicationContent).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSnapshot: expect.objectContaining({
          id: "rp-cn",
          locale: "zh-CN",
        }),
      }),
      expect.objectContaining({
        localeProfile: "zh-CN",
      }),
    );
  });

  it("still generates pdf when cover quality gate soft-fails", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      userId: "user-1",
      basics: {
        fullName: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Summary",
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });
    tailorApplicationContent.mockResolvedValueOnce({
      cvSummary: "Summary",
      cover: {
        paragraphOne: "One",
        paragraphTwo: "Two",
        paragraphThree: "Three",
      },
      source: { cv: "base", cover: "fallback" },
      reason: "quality_gate_failed",
      qualityReport: {
        passed: false,
        issues: [
          {
            code: "TOP_RESPONSIBILITY_COVERAGE",
            message: "Paragraph two does not cover top JD responsibilities with grounded evidence.",
          },
        ],
      },
    });
    applicationStore.upsert.mockResolvedValueOnce({
      id: "app-2",
    });

    const res = await POST(
      new Request("http://localhost/api/applications/generate-cover-letter", {
        method: "POST",
        body: JSON.stringify({ jobId: VALID_JOB_ID }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-cover-quality-gate")).toBe("soft-fail");
    expect(applicationStore.upsert).toHaveBeenCalled();
  });
});
