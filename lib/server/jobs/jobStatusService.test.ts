import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  jobUpdate: vi.fn(),
  applicationFindUnique: vi.fn(),
  getResumeProfile: vi.fn(),
  buildResumePdfForJob: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: stores.jobFindFirst,
      update: stores.jobUpdate,
    },
    application: {
      findUnique: stores.applicationFindUnique,
    },
  },
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: stores.getResumeProfile,
}));

vi.mock("@/lib/server/applications/buildResumePdf", () => ({
  buildResumePdfForJob: stores.buildResumePdfForJob,
}));

vi.mock("@vercel/blob", () => ({
  put: stores.put,
}));

import { updateJobStatus } from "./jobStatusService";

describe("updateJobStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.jobFindFirst.mockResolvedValue({
      id: "job-1",
      title: "Engineer",
      company: "Example",
      description: "Build products",
      status: "NEW",
    });
    stores.jobUpdate.mockResolvedValue({ id: "job-1" });
  });

  it.each(["NEW", "APPLIED", "REJECTED"] as const)(
    "updates %s without generating or persisting application artifacts",
    async (status) => {
      await expect(updateJobStatus("user-1", "job-1", status)).resolves.toEqual({
        ok: true,
      });

      expect(stores.jobUpdate).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: { status },
      });
      expect(stores.applicationFindUnique).not.toHaveBeenCalled();
      expect(stores.getResumeProfile).not.toHaveBeenCalled();
      expect(stores.buildResumePdfForJob).not.toHaveBeenCalled();
      expect(stores.put).not.toHaveBeenCalled();
    },
  );

  it("returns null without writing when the job does not belong to the user", async () => {
    stores.jobFindFirst.mockResolvedValueOnce(null);

    await expect(updateJobStatus("user-1", "job-1", "APPLIED")).resolves.toBeNull();

    expect(stores.jobUpdate).not.toHaveBeenCalled();
  });
});
