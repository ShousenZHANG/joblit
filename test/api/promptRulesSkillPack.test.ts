import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/promptRuleTemplates", () => ({
  getActivePromptSkillRulesForUser: vi.fn(() => ({
    id: "jobflow-default-v1",
    locale: "en-AU",
    cvRules: ["cv-rule"],
    coverRules: ["cover-rule"],
    hardConstraints: ["json-only"],
  })),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: vi.fn(async () => null),
}));

vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: vi.fn(() => ({ summary: "" })),
}));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/prompt-rules/skill-pack/route";

describe("prompt rules skill pack api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("requires auth", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/prompt-rules/skill-pack"));
    expect(res.status).toBe(401);
  });

  it("returns ZIP bundle by default (V2)", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const res = await GET(new Request("http://localhost/api/prompt-rules/skill-pack"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".zip");
    expect(res.headers.get("content-disposition")).toMatch(/jobflow-skills-v2/);
    expect(res.headers.get("x-skill-pack-version")?.length).toBe(64);
  });

  it("returns tar.gz when format=tar.gz (V1 backward compat)", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const res = await GET(new Request("http://localhost/api/prompt-rules/skill-pack?format=tar.gz"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toContain(".tar.gz");
  });

  it("returns global skill pack even if jobId query is provided", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const res = await GET(
      new Request("http://localhost/api/prompt-rules/skill-pack?jobId=550e8400-e29b-41d4-a716-446655440000"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
  });

  it("supports redacted skill pack download mode", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const res = await GET(new Request("http://localhost/api/prompt-rules/skill-pack?redact=true"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("x-skill-pack-redacted")).toBe("1");
  });
});
