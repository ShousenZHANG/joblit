import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaStore = vi.hoisted(() => ({
  extensionToken: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
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

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaStore }));

import { POST } from "@/app/api/ext/jobs/import/route";

function req(body: unknown, withToken = true) {
  return new Request("http://localhost/api/ext/jobs/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withToken ? { Authorization: "Bearer ext-raw-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("ext jobs import api", () => {
  beforeEach(() => {
    prismaStore.extensionToken.findFirst.mockReset();
    prismaStore.extensionToken.updateMany.mockReset();
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

    prismaStore.extensionToken.findFirst.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000_000),
      lastUsedAt: null,
    });
    prismaStore.extensionToken.updateMany.mockResolvedValue({ count: 1 });
    prismaStore.deletedJobUrl.findMany.mockResolvedValue([]);
    prismaStore.job.createMany.mockResolvedValue({ count: 1 });
  });

  it("imports browser-extension jobs for the token's user", async () => {
    const res = await POST(
      req({
        items: [
          { jobUrl: "https://au.seek.com/job/92319306", title: "Software engineer", company: "Acme" },
        ],
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.imported).toBe(1);
    const created = prismaStore.job.createMany.mock.calls[0]?.[0]?.data?.[0];
    expect(created?.userId).toBe("user-1");
    expect(created?.jobUrl).toBe("https://au.seek.com/job/92319306");
    expect(created?.status).toBe("NEW");
  });

  it("rejects a request with no extension token (401)", async () => {
    const res = await POST(req({ items: [] }, false));
    expect(res.status).toBe(401);
    expect(prismaStore.job.createMany).not.toHaveBeenCalled();
  });

  it("never resurrects a tombstoned (deleted) job", async () => {
    prismaStore.deletedJobUrl.findMany.mockResolvedValueOnce([
      { jobUrl: "https://au.seek.com/job/92319306" },
    ]);
    const res = await POST(
      req({ items: [{ jobUrl: "https://au.seek.com/job/92319306", title: "Software engineer" }] }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.imported).toBe(0);
    expect(prismaStore.job.createMany).not.toHaveBeenCalled();
  });

  it("rejects an over-cap batch (>200 items) as 400", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({
      jobUrl: `https://au.seek.com/job/${i}`,
      title: "t",
    }));
    const res = await POST(req({ items }));
    expect(res.status).toBe(400);
    expect(prismaStore.job.createMany).not.toHaveBeenCalled();
  });
});
