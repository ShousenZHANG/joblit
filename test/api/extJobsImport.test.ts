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
    updateMany: vi.fn(),
  },
  applicationEvent: {
    findMany: vi.fn(),
  },
  executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
const extensionIngress = vi.hoisted(() => ({
  withRoute: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaStore }));
vi.mock("@/lib/server/extensionIngress/withExtensionRoute", () => ({
  withExtensionRoute: extensionIngress.withRoute,
}));

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
    extensionIngress.withRoute.mockReset();
    extensionIngress.withRoute.mockImplementation(
      async (
        _request: Request,
        _operation: string,
        handler: (context: {
          userId: string;
          requestId: string;
        }) => Promise<Response>,
      ) => handler({ userId: "user-1", requestId: "req-1" }),
    );
    prismaStore.extensionToken.findFirst.mockReset();
    prismaStore.extensionToken.updateMany.mockReset();
    prismaStore.deletedJobUrl.findMany.mockReset();
    prismaStore.job.createMany.mockReset();
    prismaStore.job.updateMany.mockReset();
    prismaStore.applicationEvent.findMany.mockReset();
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
    prismaStore.job.updateMany.mockResolvedValue({ count: 1 });
    prismaStore.applicationEvent.findMany.mockResolvedValue([]);
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
    expect(extensionIngress.withRoute).toHaveBeenCalledWith(
      expect.any(Request),
      "jobs.import",
      expect.any(Function),
    );
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

  it("throws a public IMPORT_FAILED AppError with the private cause attached", async () => {
    const failure = new Error("database details");
    prismaStore.$transaction.mockRejectedValueOnce(failure);

    let thrown: unknown;
    try {
      await POST(
        req({
          items: [
            {
              jobUrl: "https://au.seek.com/job/92319306",
              title: "Software engineer",
            },
          ],
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "IMPORT_FAILED",
      status: 500,
      publicMessage: "Could not import jobs",
      privateDetails: failure,
      cause: failure,
    });
  });
});
