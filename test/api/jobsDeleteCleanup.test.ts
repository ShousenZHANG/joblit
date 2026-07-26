import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
}));

const deletedJobUrlStore = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
}));

const evidenceSnapshotStore = vi.hoisted(() => ({
  deleteMany: vi.fn(),
}));

const claimEvidenceStore = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

const prismaStore = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

const artifactStore = vi.hoisted(() => ({
  enqueue: vi.fn(),
}));

vi.mock("@/lib/server/artifacts/applicationArtifactLifecycle", () => ({
  enqueueApplicationArtifactRetirements: artifactStore.enqueue,
  canonicalizeApplicationArtifactStorageIdentity: (value: string) => {
    const parsed = new URL(value.trim());
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    return {
      storeHost: parsed.hostname.toLowerCase(),
      pathname,
      key: `${parsed.hostname.toLowerCase()}/${pathname}`,
    };
  },
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
    deletedJobUrl: deletedJobUrlStore,
    application: applicationStore,
    $transaction: prismaStore.$transaction,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { DELETE } from "@/app/api/jobs/[id]/route";

const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("jobs delete api cleanup", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    jobStore.findFirst.mockReset();
    jobStore.deleteMany.mockReset();
    deletedJobUrlStore.upsert.mockReset();
    applicationStore.findUnique.mockReset();
    applicationStore.deleteMany.mockReset();
    claimEvidenceStore.findMany.mockReset().mockResolvedValue([]);
    prismaStore.executeRaw.mockReset().mockResolvedValue(0);
    prismaStore.$transaction.mockReset();
    artifactStore.enqueue.mockReset().mockResolvedValue({ queued: 2 });
    prismaStore.$transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: prismaStore.executeRaw,
        job: jobStore,
        deletedJobUrl: deletedJobUrlStore,
        application: applicationStore,
        evidenceSnapshot: evidenceSnapshotStore,
        claimEvidence: claimEvidenceStore,
      }),
    );
  });

  it("deletes the job after durably queuing linked Blob artifacts", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: JOB_ID,
      jobUrl: "https://www.linkedin.com/jobs/view/1/?tracking=abc",
    });
    applicationStore.findUnique.mockResolvedValueOnce({
      id: "application-1",
      jobId: JOB_ID,
      resumePdfUrl: "https://blob.vercel-storage.com/r1.pdf",
      coverPdfUrl: "https://blob.vercel-storage.com/c1.pdf",
      resumeTexUrl: null,
      coverTexUrl: null,
    });
    deletedJobUrlStore.upsert.mockResolvedValueOnce({ id: "deleted-url-1" });
    applicationStore.deleteMany.mockResolvedValueOnce({ count: 1 });
    jobStore.deleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await DELETE(
      new Request(`http://localhost/api/jobs/${JOB_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: JOB_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(applicationStore.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", jobId: JOB_ID },
    });
    expect(artifactStore.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        jobId: JOB_ID,
        applicationId: "application-1",
        artifacts: [
          {
            target: "RESUME_PDF",
            url: "https://blob.vercel-storage.com/r1.pdf",
          },
          {
            target: "COVER_PDF",
            url: "https://blob.vercel-storage.com/c1.pdf",
          },
        ],
      },
    );
    expect(json.blobCleanup).toEqual({
      attempted: 2,
      deleted: 0,
      failed: 0,
    });
    expect(json.artifactRetirement).toEqual({ queued: 2 });
  });
});
