import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/application-batches/[id]/trigger/route";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("application batch trigger api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("returns 410 because automatic trigger execution is disabled", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/trigger`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json.error.code).toBe("TRIGGER_DISABLED");
    expect(json.error.details.batchId).toBe(BATCH_ID);
  });
});
