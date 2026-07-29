import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));
const extensionIngress = vi.hoisted(() => ({
  withRoute: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
  },
}));

vi.mock("@/lib/server/extensionIngress/withExtensionRoute", () => ({
  withExtensionRoute: extensionIngress.withRoute,
}));

import { GET } from "@/app/api/ext/jobs/match/route";

describe("extension jobs match api", () => {
  beforeEach(() => {
    jobStore.findFirst.mockReset();
    jobStore.findFirst.mockResolvedValue(null);
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
  });

  it("canonicalizes browser job URLs before matching stored jobs", async () => {
    await GET(
      new Request(
        "http://localhost/api/ext/jobs/match?url=" +
          encodeURIComponent("https://au.linkedin.com/jobs/search/?currentJobId=123456&trackingId=abc"),
      ),
    );

    expect(jobStore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          jobUrl: "https://linkedin.com/jobs/view/123456",
        },
      }),
    );
    expect(extensionIngress.withRoute).toHaveBeenCalledWith(
      expect.any(Request),
      "jobs.match",
      expect.any(Function),
    );
  });
});
