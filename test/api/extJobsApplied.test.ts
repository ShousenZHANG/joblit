import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  requireToken: vi.fn(),
  findFirst: vi.fn(),
  appendApplicationEvent: vi.fn(),
}));

vi.mock("@/lib/server/auth/requireExtensionToken", () => {
  class ExtensionTokenError extends Error {}
  return {
    ExtensionTokenError,
    requireExtensionToken: stores.requireToken,
  };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: stores.findFirst,
    },
  },
}));

vi.mock("@/lib/server/applications/applicationEvents", () => ({
  appendApplicationEvent: stores.appendApplicationEvent,
}));

import { POST } from "@/app/api/ext/jobs/applied/route";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function request(body: unknown) {
  return new Request("http://localhost/api/ext/jobs/applied", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ext/jobs/applied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.requireToken.mockResolvedValue({ userId: "user-1" });
    stores.findFirst.mockResolvedValue({
      id: JOB_ID,
      status: "NEW",
      title: "Engineer",
      company: "Example",
    });
    stores.appendApplicationEvent.mockResolvedValue({
      event: { id: "event-1" },
      replayed: false,
    });
  });

  it("appends an extension-sourced event instead of directly updating Job", async () => {
    const response = await POST(request({ jobId: JOB_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: JOB_ID,
        status: "APPLIED",
        title: "Engineer",
        company: "Example",
      },
    });
    expect(stores.appendApplicationEvent).toHaveBeenCalledWith("user-1", {
      jobId: JOB_ID,
      type: "STATUS_CHANGED",
      source: "EXTENSION",
      toStatus: "APPLIED",
      expectedFromStatus: "NEW",
      note: "Application submitted from Chrome extension",
    });
  });

  it("keeps repeated calls idempotent when the projection is already APPLIED", async () => {
    stores.findFirst.mockResolvedValueOnce({
      id: JOB_ID,
      status: "APPLIED",
      title: "Engineer",
      company: "Example",
    });
    const response = await POST(request({ jobId: JOB_ID }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("APPLIED");
    expect(stores.appendApplicationEvent).not.toHaveBeenCalled();
  });

  it("never exposes another tenant's job", async () => {
    stores.findFirst.mockResolvedValueOnce(null);
    const response = await POST(request({ jobId: JOB_ID }));
    expect(response.status).toBe(404);
    expect(stores.appendApplicationEvent).not.toHaveBeenCalled();
  });
});
