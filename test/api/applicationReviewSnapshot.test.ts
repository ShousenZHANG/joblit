import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  application: { findFirst: vi.fn() },
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: stores }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/applications/[id]/review-snapshot/route";

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const MASTER_SKILLS = [
  { category: "Languages", items: ["TypeScript", "Go"] },
  { category: "Platform", items: ["Kubernetes"] },
];

function ownedApplication(skills: unknown = MASTER_SKILLS) {
  return {
    id: APPLICATION_ID,
    status: "DRAFT",
    aiContent: {
      schemaVersion: 1,
      generatedAt: "2026-08-10T00:00:00.000Z",
      promptMetaHash: "prompt-hash",
      cv: {
        summary: {
          aiText: "Platform engineer.",
          originalText: "Engineer.",
          accepted: true,
        },
        latestExperience: { experienceIndex: 0, addedBullets: [] },
      },
      cover: {
        paragraphOne: { aiText: "One", accepted: true },
        paragraphTwo: { aiText: "Two", accepted: true },
        paragraphThree: { aiText: "Three", accepted: true },
      },
    },
    aiContentHash: "content-hash",
    resumePdfUrl: "https://example.com/cv.pdf",
    resumePdfName: "Stored CV.pdf",
    coverPdfUrl: "https://example.com/cl.pdf",
    resumeContentHash: null,
    coverContentHash: null,
    resumePublishedHash: null,
    coverPublishedHash: null,
    role: null,
    company: null,
    jobId: JOB_ID,
    resumeProfileId: "44444444-4444-4444-8444-444444444444",
    job: {
      id: JOB_ID,
      userId: "user-1",
      title: "Platform Engineer",
      company: "Lumi",
      location: "Sydney",
      market: "AU",
    },
    resumeProfile: {
      userId: "user-1",
      summary: "Platform engineer.",
      basics: {
        fullName: "Alex Chen",
        title: "Platform Engineer",
        email: "alex@example.com",
        phone: "+61 400 000 000",
      },
      links: [],
      skills,
      experiences: [],
      projects: [],
      education: [],
    },
  };
}

function request() {
  return GET(
    new Request(
      `http://localhost/api/applications/${APPLICATION_ID}/review-snapshot`,
    ),
    { params: Promise.resolve({ id: APPLICATION_ID }) },
  );
}

describe("application review snapshot api", () => {
  beforeEach(() => {
    stores.application.findFirst.mockReset();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("marks even an unauthenticated response no-store", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const response = await request();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("returns the owned editor bootstrap as private no-store data", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    stores.application.findFirst.mockResolvedValueOnce(ownedApplication());

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(body).toEqual(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        aiContentHash: "content-hash",
        job: expect.objectContaining({ id: JOB_ID, title: "Platform Engineer" }),
      }),
    );
    expect(body).not.toHaveProperty("prompt");
    // The review panel resolves the stored index references against this bank;
    // without it a selection has numbers and no names to render.
    expect(body.masterSkills).toEqual(MASTER_SKILLS);
  });

  it("returns an empty skill bank when the stored profile skills are unreadable", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    stores.application.findFirst.mockResolvedValueOnce(
      ownedApplication("not-a-bank"),
    );

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.masterSkills).toEqual([]);
  });
});
