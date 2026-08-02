import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { job: jobStore },
}));

vi.mock("@/lib/server/jobs/jobDeleteService", () => ({
  deleteJob: vi.fn(),
}));

vi.mock("@/lib/server/jobs/jobStatusService", () => ({
  updateJobStatus: vi.fn(),
}));

vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/jobs/[id]/route";

const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("GET /api/jobs/[id]", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue({ user: { id: "user-1" } });
    jobStore.findFirst.mockReset();
  });

  it("derives candidate experience from the authoritative current JD", async () => {
    jobStore.findFirst.mockResolvedValue({
      id: JOB_ID,
      description: [
        "Our company has operated for 20 years.",
        "Minimum requirements:",
        "At least 3 years of backend engineering experience.",
      ].join("\n"),
      fitMatrix: null,
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    });

    const response = await GET(
      new Request(`http://localhost/api/jobs/${JOB_ID}`),
      { params: Promise.resolve({ id: JOB_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobStore.findFirst).toHaveBeenCalledWith({
      where: { id: JOB_ID, userId: "user-1" },
      select: {
        id: true,
        description: true,
        fitMatrix: true,
        updatedAt: true,
      },
    });
    expect(body.experienceAnalysis).toMatchObject({
      schemaVersion: 1,
      status: "FOUND",
      requirements: [
        {
          classification: "REQUIRED",
          years: { operator: "MINIMUM", min: 3, max: null },
        },
      ],
    });
    expect(body.experienceAnalysis.requirements).toHaveLength(1);
  });

  it("returns an empty analysis when the source has no description", async () => {
    jobStore.findFirst.mockResolvedValue({
      id: JOB_ID,
      description: null,
      fitMatrix: null,
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    });

    const response = await GET(
      new Request(`http://localhost/api/jobs/${JOB_ID}`),
      { params: Promise.resolve({ id: JOB_ID }) },
    );

    expect((await response.json()).experienceAnalysis).toEqual({
      schemaVersion: 1,
      status: "NONE",
      requirements: [],
    });
  });
});
