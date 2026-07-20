import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  events: vi.fn(),
  reminders: vi.fn(),
  offers: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationEvent: { findMany: stores.events },
    followUpReminder: { findMany: stores.reminders },
    offer: { findMany: stores.offers },
  },
}));

import { deriveReminderSuggestions } from "@/lib/server/career/records";

describe("on-demand career reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.reminders.mockResolvedValue([]);
    stores.offers.mockResolvedValue([]);
  });

  it("derives due reminders without creating or scheduling background work", async () => {
    stores.events.mockResolvedValue([
      {
        jobId: "applied-job",
        toStatus: "APPLIED",
        occurredAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        jobId: "interview-job",
        toStatus: "INTERVIEW",
        occurredAt: new Date("2026-07-08T00:00:00.000Z"),
      },
    ]);
    stores.offers.mockResolvedValue([
      {
        id: "offer-1",
        jobId: "offer-job",
        company: "Example",
        deadlineAt: new Date("2026-07-11T00:00:00.000Z"),
      },
    ]);

    const result = await deriveReminderSuggestions(
      "user-1",
      new Date("2026-07-10T00:00:00.000Z"),
    );

    expect(result.map((item) => item.type)).toEqual([
      "APPLICATION_FOLLOW_UP",
      "INTERVIEW_THANK_YOU",
      "OFFER_DEADLINE",
    ]);
    expect(stores.events).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  it("does not repeat an equivalent persisted reminder", async () => {
    const appliedAt = new Date("2026-07-01T00:00:00.000Z");
    const dueAt = new Date("2026-07-06T00:00:00.000Z");
    stores.events.mockResolvedValue([
      { jobId: "job-1", toStatus: "APPLIED", occurredAt: appliedAt },
    ]);
    stores.reminders.mockResolvedValue([
      {
        jobId: "job-1",
        type: "APPLICATION_FOLLOW_UP",
        dueAt,
      },
    ]);

    await expect(
      deriveReminderSuggestions("user-1", new Date("2026-07-10T00:00:00.000Z")),
    ).resolves.toEqual([]);
  });
});
