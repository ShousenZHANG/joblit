import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaStore = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  deletedJobUrl: {
    findMany: vi.fn(),
  },
  job: {
    createMany: vi.fn(),
  },
  executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: prismaStore,
}));

import { POST } from "@/app/api/admin/import/route";

describe("admin import api", () => {
  beforeEach(() => {
    process.env.IMPORT_SECRET = "import-secret";
    prismaStore.user.findUnique.mockReset();
    prismaStore.deletedJobUrl.findMany.mockReset();
    prismaStore.job.createMany.mockReset();
    prismaStore.executeRaw.mockReset().mockResolvedValue(0);
    prismaStore.$transaction.mockReset().mockImplementation(async (callback) =>
      callback({
        $executeRaw: prismaStore.executeRaw,
        deletedJobUrl: prismaStore.deletedJobUrl,
        job: prismaStore.job,
      }),
    );

    prismaStore.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaStore.deletedJobUrl.findMany.mockResolvedValue([]);
    prismaStore.job.createMany.mockResolvedValue({ count: 1 });
  });

  it("canonicalizes tracking variants and imports only one record", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-import-secret": "import-secret",
        },
        body: JSON.stringify({
          userEmail: "user@example.com",
          items: [
            {
              jobUrl: "https://www.linkedin.com/jobs/view/123/?trk=abc",
              title: "Software Engineer",
            },
            {
              jobUrl: "https://linkedin.com/jobs/view/123?tracking=def#fragment",
              title: "Software Engineer",
            },
          ],
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported).toBe(1);
    expect(prismaStore.job.createMany).toHaveBeenCalledTimes(1);
    const created = prismaStore.job.createMany.mock.calls[0]?.[0]?.data?.[0];
    expect(created?.jobUrl).toBe("https://linkedin.com/jobs/view/123");
  });

  it("normalizes LinkedIn currentJobId variants to the stable jobs/view URL", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-import-secret": "import-secret",
        },
        body: JSON.stringify({
          userEmail: "user@example.com",
          items: [
            {
              jobUrl:
                "https://www.linkedin.com/jobs/search/?keywords=Backend%20Engineer&currentJobId=456&trk=public_jobs_jobs-search-bar_search-submit",
              title: "Backend Engineer",
            },
          ],
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported).toBe(1);
    const created = prismaStore.job.createMany.mock.calls[0]?.[0]?.data?.[0];
    expect(created?.jobUrl).toBe("https://linkedin.com/jobs/view/456");
  });

  it("filters out deleted LinkedIn jobs even when incoming URL is a currentJobId variant", async () => {
    prismaStore.deletedJobUrl.findMany.mockResolvedValueOnce([
      { jobUrl: "https://linkedin.com/jobs/view/777" },
    ]);

    const res = await POST(
      new Request("http://localhost/api/admin/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-import-secret": "import-secret",
        },
        body: JSON.stringify({
          userEmail: "user@example.com",
          items: [
            {
              jobUrl:
                "https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer&currentJobId=777&trk=public_jobs_jobs-search-bar_search-submit",
              title: "Software Engineer",
            },
          ],
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported).toBe(0);
    expect(prismaStore.job.createMany).not.toHaveBeenCalled();
  });

  it("filters out entries that match deleted URLs after canonicalization", async () => {
    prismaStore.deletedJobUrl.findMany.mockResolvedValueOnce([
      { jobUrl: "https://linkedin.com/jobs/view/777" },
    ]);

    const res = await POST(
      new Request("http://localhost/api/admin/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-import-secret": "import-secret",
        },
        body: JSON.stringify({
          userEmail: "user@example.com",
          items: [
            {
              jobUrl: "https://linkedin.com/jobs/view/777/?refId=abc",
              title: "Backend Engineer",
            },
          ],
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported).toBe(0);
    expect(prismaStore.job.createMany).not.toHaveBeenCalled();
  });
});
