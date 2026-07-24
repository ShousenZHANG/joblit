import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveRules: vi.fn(),
  getResumeProfile: vi.fn(),
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/promptRuleTemplates", () => ({
  getActivePromptSkillRulesForUser: mocks.getActiveRules,
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: mocks.getResumeProfile,
}));

vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: vi.fn(() => ({ summary: "" })),
}));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/prompt-rules/skill-pack/route";

type EffectiveRules = {
  id: string;
  locale: "en-AU";
  cvRules: string[];
  coverRules: string[];
  hardConstraints: string[];
};

function effectiveRules(
  overrides: Partial<EffectiveRules> = {},
): EffectiveRules {
  return {
    id: "active-template",
    locale: "en-AU",
    cvRules: ["active resume rule"],
    coverRules: ["active cover rule"],
    hardConstraints: ["active hard constraint"],
    ...overrides,
  };
}

function readZipText(bytes: ArrayBuffer, expectedName: string): string {
  const zip = Buffer.from(bytes);
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const fileNameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);

    if (name === expectedName) {
      if (compressionMethod !== 8) {
        throw new Error(`unsupported ZIP compression method ${compressionMethod}`);
      }
      return inflateRawSync(compressed).toString("utf8");
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`missing ZIP entry: ${expectedName}`);
}

describe("prompt rules skill pack api", () => {
  beforeEach(() => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockReset();
    mocks.getActiveRules.mockReset();
    mocks.getActiveRules.mockResolvedValue(effectiveRules());
    mocks.getResumeProfile.mockReset();
    mocks.getResumeProfile.mockResolvedValue(null);
  });

  it("requires auth", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);
    const response = await GET(
      new Request("http://localhost/api/prompt-rules/skill-pack"),
    );
    expect(response.status).toBe(401);
  });

  it("returns a V3 ZIP bundle by default", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const response = await GET(
      new Request("http://localhost/api/prompt-rules/skill-pack"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(
      /joblit-skills-v3.*\.zip/,
    );
    expect(response.headers.get("x-skill-pack-version")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("packages the user's active effective rules instead of defaults", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    mocks.getActiveRules.mockResolvedValueOnce(
      effectiveRules({
        cvRules: ["user active resume rule"],
        coverRules: ["user active cover rule"],
        hardConstraints: ["user active hard constraint"],
      }),
    );

    const response = await GET(
      new Request("http://localhost/api/prompt-rules/skill-pack"),
    );
    const bytes = await response.arrayBuffer();
    const resumeRules = JSON.parse(
      readZipText(
        bytes,
        "joblit-skills-v3/rules/resume-rules.json",
      ),
    );
    const hardConstraints = JSON.parse(
      readZipText(
        bytes,
        "joblit-skills-v3/rules/hard-constraints.json",
      ),
    );

    expect(
      resumeRules.rules.map((rule: { text: string }) => rule.text),
    ).toEqual(["user active resume rule"]);
    expect(
      hardConstraints.rules.map((rule: { text: string }) => rule.text),
    ).toEqual(["user active hard constraint"]);
  });

  it("changes the content version when effective rule content changes under the same id", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: "user-1" },
    });
    mocks.getActiveRules.mockResolvedValueOnce(
      effectiveRules({ cvRules: ["first active rule"] }),
    );
    const first = await GET(
      new Request("http://localhost/api/prompt-rules/skill-pack"),
    );

    mocks.getActiveRules.mockResolvedValueOnce(
      effectiveRules({ cvRules: ["changed active rule"] }),
    );
    const second = await GET(
      new Request("http://localhost/api/prompt-rules/skill-pack"),
    );

    expect(second.headers.get("x-skill-pack-version")).not.toBe(
      first.headers.get("x-skill-pack-version"),
    );
  });

  it("localizes the V3 package without replacing active effective rules", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const response = await GET(
      new Request(
        "http://localhost/api/prompt-rules/skill-pack?locale=zh-CN",
      ),
    );
    const bytes = await response.arrayBuffer();
    const manifest = JSON.parse(
      readZipText(bytes, "joblit-skills-v3/meta/manifest.json"),
    );
    const resumeRules = JSON.parse(
      readZipText(
        bytes,
        "joblit-skills-v3/rules/resume-rules.json",
      ),
    );

    expect(response.headers.get("x-skill-pack-locale")).toBe("zh-CN");
    expect(response.headers.get("content-disposition")).toContain("zh-CN");
    expect(manifest.locale).toBe("zh-CN");
    expect(
      resumeRules.rules.map((rule: { text: string }) => rule.text),
    ).toEqual(["active resume rule"]);
    expect(mocks.getResumeProfile).toHaveBeenCalledWith("user-1", {
      locale: "zh-CN",
    });
  });

  it("returns the generation receipt identity for the exact locale profile", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    mocks.getResumeProfile.mockResolvedValueOnce({
      summary: "Backend engineer",
      basics: { fullName: "Jane Doe", title: "Engineer" },
      links: [],
      skills: [],
      experiences: [],
      projects: [],
      education: [],
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    });

    const response = await GET(
      new Request(
        "http://localhost/api/prompt-rules/skill-pack?locale=zh-CN",
      ),
    );

    expect(response.headers.get("x-generation-receipt-version")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(mocks.getResumeProfile).toHaveBeenCalledWith("user-1", {
      locale: "zh-CN",
    });
  });

  it("keeps generation receipt freshness locale-bound even for identical profiles", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: "user-1" },
    });
    const profile = {
      summary: "Same content",
      basics: { fullName: "Jane Doe", title: "Engineer" },
      links: [],
      skills: [],
      experiences: [],
      projects: [],
      education: [],
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    };
    mocks.getResumeProfile.mockResolvedValue(profile);

    const en = await GET(
      new Request(
        "http://localhost/api/prompt-rules/skill-pack?locale=en-AU",
      ),
    );
    const zh = await GET(
      new Request(
        "http://localhost/api/prompt-rules/skill-pack?locale=zh-CN",
      ),
    );

    expect(zh.headers.get("x-generation-receipt-version")).not.toBe(
      en.headers.get("x-generation-receipt-version"),
    );
  });

  it("returns a global skill pack even if jobId is provided", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const response = await GET(
      new Request(
        "http://localhost/api/prompt-rules/skill-pack?jobId=550e8400-e29b-41d4-a716-446655440000",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
  });

  it("supports redacted skill pack download mode", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      user: { id: "user-1" },
    });
    const response = await GET(
      new Request(
        "http://localhost/api/prompt-rules/skill-pack?redact=true",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-skill-pack-redacted")).toBe("1");
  });
});
