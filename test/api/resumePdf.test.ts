import { beforeEach, describe, expect, it, vi } from "vitest";

const resumeProfileStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const activeResumeProfileStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    resumeProfile: resumeProfileStore,
    activeResumeProfile: activeResumeProfileStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/latex/renderResume", () => ({
  renderResumeTex: vi.fn(() => "\\documentclass{article}"),
}));

vi.mock("@/lib/server/net/safeFetch", () => ({
  SafeOutboundError: class SafeOutboundError extends Error {},
  parseSafeOutboundUrl: (url: string | URL) => new URL(url),
  safeOutboundFetch: (
    url: string | URL,
    init?: RequestInit,
  ) => fetch(url, { ...init, redirect: "manual" }),
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/resume-pdf/route";

// A valid-looking PDF stub: "%PDF-1.7" header padded past the render integrity
// floor (1KB) so compileLatexToPdf accepts it.
const mockPdf = (() => {
  const bytes = new Uint8Array(1200);
  bytes.set([37, 80, 68, 70, 45, 49, 46, 55], 0); // "%PDF-1.7"
  return bytes;
})();

describe("resume pdf api", () => {
  beforeEach(() => {
    resumeProfileStore.findFirst.mockReset();
    activeResumeProfileStore.findUnique.mockReset();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.LATEX_RENDER_URL = "https://latex.example.com/compile";
    process.env.LATEX_RENDER_TOKEN = "test-token";
  });

  it("returns 404 when profile is missing", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    activeResumeProfileStore.findUnique.mockResolvedValueOnce(null);
    resumeProfileStore.findFirst.mockResolvedValueOnce(null);

    const res = await POST(new Request("http://localhost/api/resume-pdf"));
    expect(res.status).toBe(404);
  });

  it("returns a pdf download when profile exists", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-1" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-1",
      userId: "user-1",
      summary: "Hi",
      basics: {
        fullName: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
        location: "Sydney",
      },
      links: [{ label: "LinkedIn", url: "https://linkedin.com/in/jane" }],
      experiences: [
        {
          location: "Sydney",
          dates: "2023-2025",
          title: "Engineer",
          company: "Example Co",
          bullets: ["Built"],
        },
      ],
      projects: [],
      education: [],
      skills: [{ category: "Languages", items: ["TypeScript"] }],
    });

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockPdf.buffer,
      headers: new Headers({ "content-type": "application/pdf" }),
    });

    const res = await POST(new Request("http://localhost/api/resume-pdf"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  });

  it("does not fetch untrusted CN profile photo URLs", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-cn" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-cn",
      userId: "user-1",
      locale: "zh-CN",
      summary: "Summary",
      basics: {
        fullName: "张三",
        title: "软件工程师",
        email: "zhangsan@example.com",
        phone: "13800138000",
        photoUrl: "https://evil.example.com/photo.png",
      },
      links: [],
      experiences: [],
      projects: [],
      education: [],
      skills: [{ category: "技能", items: ["TypeScript"] }],
    });

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockPdf.buffer,
      headers: new Headers({ "content-type": "application/pdf" }),
    });

    const res = await POST(new Request("http://localhost/api/resume-pdf?locale=zh-CN"));

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://latex.example.com/compile",
    );
    const compileBody = JSON.parse(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(compileBody.files).toBeUndefined();
  });

  it("attaches only bounded trusted CN profile photos to the LaTeX render request", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-cn" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-cn",
      userId: "user-1",
      locale: "zh-CN",
      summary: "Summary",
      basics: {
        fullName: "张三",
        title: "软件工程师",
        email: "zhangsan@example.com",
        phone: "13800138000",
        photoUrl:
          "https://store.public.blob.vercel-storage.com/resume-photos/user-1/photo.png",
      },
      links: [],
      experiences: [],
      projects: [],
      education: [],
      skills: [{ category: "技能", items: ["TypeScript"] }],
    });

    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "image/png",
            "content-length": "3",
          },
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockPdf.buffer,
        headers: new Headers({ "content-type": "application/pdf" }),
      });

    const res = await POST(new Request("http://localhost/api/resume-pdf?locale=zh-CN"));

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    const compileBody = JSON.parse(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
    );
    expect(compileBody.files).toEqual([{ name: "photo.png", base64: "AQID" }]);
  });
});
