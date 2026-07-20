import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  appendApplicationEvent: vi.fn(),
  applicationFindUnique: vi.fn(),
  getResumeProfile: vi.fn(),
  buildResumePdfForJob: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: stores.jobFindFirst,
    },
    application: {
      findUnique: stores.applicationFindUnique,
    },
  },
}));

vi.mock("@/lib/server/applications/applicationEvents", () => ({
  appendApplicationEvent: stores.appendApplicationEvent,
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
    stores.appendApplicationEvent.mockResolvedValue({
      event: { id: "event-1" },
      replayed: false,
    });
  });

  it.each(["APPLIED", "REJECTED", "WITHDRAWN"] as const)(
    "appends an immutable event when moving NEW to %s",
    async (status) => {
      await expect(updateJobStatus("user-1", "job-1", status)).resolves.toEqual({
        ok: true,
      });

      expect(stores.appendApplicationEvent).toHaveBeenCalledWith("user-1", {
        jobId: "job-1",
        type: "STATUS_CHANGED",
        source: "USER",
        toStatus: status,
        expectedFromStatus: "NEW",
      });
      expect(stores.applicationFindUnique).not.toHaveBeenCalled();
      expect(stores.getResumeProfile).not.toHaveBeenCalled();
      expect(stores.buildResumePdfForJob).not.toHaveBeenCalled();
      expect(stores.put).not.toHaveBeenCalled();
    },
  );

  it("does not append a duplicate event for an idempotent same-status patch", async () => {
    await expect(updateJobStatus("user-1", "job-1", "NEW")).resolves.toEqual({
      ok: true,
    });

    expect(stores.appendApplicationEvent).not.toHaveBeenCalled();
  });

  it("returns null without writing when the job does not belong to the user", async () => {
    stores.jobFindFirst.mockResolvedValueOnce(null);

    await expect(updateJobStatus("user-1", "job-1", "APPLIED")).resolves.toBeNull();

    expect(stores.appendApplicationEvent).not.toHaveBeenCalled();
  });
});
