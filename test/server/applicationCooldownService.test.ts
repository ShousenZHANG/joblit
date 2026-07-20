import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationEvent: { findMany: store.findMany },
  },
}));

import {
  buildUserCooldownFilter,
  inferApplicationRoleFamily,
  loadApplicationCooldownRules,
} from "@/lib/server/jobs/applicationCooldownService";

const NOW = new Date("2026-07-20T00:00:00Z");

describe("application cooldown service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups recent APPLIED events into company title and role-family rules", async () => {
    store.findMany.mockResolvedValue([
      {
        occurredAt: new Date("2026-07-19T00:00:00Z"),
        job: { company: "Acme", title: "Senior Backend Engineer" },
      },
      {
        occurredAt: new Date("2026-07-10T00:00:00Z"),
        job: { company: "Acme", title: "Platform Engineer" },
      },
      {
        occurredAt: new Date("2026-07-18T00:00:00Z"),
        job: { company: null, title: "Unknown Employer Role" },
      },
    ]);

    const rules = await loadApplicationCooldownRules("user-1", {
      sameRoleDays: 30,
      now: NOW,
    });

    expect(store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          type: "STATUS_CHANGED",
          toStatus: "APPLIED",
          occurredAt: {
            gte: new Date("2026-06-20T00:00:00Z"),
            lte: NOW,
          },
        }),
      }),
    );
    expect(rules).toEqual([
      {
        company: "Acme",
        lastApplyDate: new Date("2026-07-19T00:00:00Z"),
        sameRoleDays: 30,
        appliedTo: ["Senior Backend Engineer"],
        crossRoleBucket: ["backend"],
      },
      {
        company: "Acme",
        lastApplyDate: new Date("2026-07-10T00:00:00Z"),
        sameRoleDays: 30,
        appliedTo: ["Platform Engineer"],
        crossRoleBucket: ["platform"],
      },
    ]);
  });

  it("does not extend an older role-family window with another family's date", async () => {
    store.findMany.mockResolvedValue([
      {
        occurredAt: new Date("2026-07-19T00:00:00Z"),
        job: { company: "Acme", title: "Backend Engineer" },
      },
      {
        occurredAt: new Date("2026-06-01T00:00:00Z"),
        job: { company: "Acme", title: "Platform Engineer" },
      },
    ]);

    const keep = await buildUserCooldownFilter("user-1", {
      sameRoleDays: 30,
      now: NOW,
    });

    expect(
      keep({
        company: "Acme",
        title: "Site Reliability Engineer",
        roleFamily: "platform",
      }),
    ).toBe(true);
    expect(
      keep({
        company: "Acme",
        title: "Backend Developer",
        roleFamily: "backend",
      }),
    ).toBe(false);
  });

  it("builds a reusable filter from event history", async () => {
    store.findMany.mockResolvedValue([
      {
        occurredAt: new Date("2026-07-19T00:00:00Z"),
        job: { company: "Acme", title: "Backend Engineer" },
      },
    ]);

    const keep = await buildUserCooldownFilter("user-1", {
      sameRoleDays: 30,
      now: NOW,
    });

    expect(
      keep({ company: "Acme Pty Ltd", title: "Backend Engineer" }),
    ).toBe(false);
    expect(
      keep({ company: "Globex", title: "Backend Engineer" }),
    ).toBe(true);
  });

  it("uses immutable snapshots after the related job is hard-deleted", async () => {
    store.findMany.mockResolvedValue([
      {
        occurredAt: new Date("2026-07-19T00:00:00Z"),
        companySnapshot: "Acme",
        titleSnapshot: "Backend Engineer",
        job: null,
      },
    ]);

    const rules = await loadApplicationCooldownRules("user-1", {
      sameRoleDays: 30,
      now: NOW,
    });

    expect(rules).toEqual([
      {
        company: "Acme",
        lastApplyDate: new Date("2026-07-19T00:00:00Z"),
        sameRoleDays: 30,
        appliedTo: ["Backend Engineer"],
        crossRoleBucket: ["backend"],
      },
    ]);
  });

  it("infers common English role families and disables a zero-day window", async () => {
    expect(inferApplicationRoleFamily("Machine Learning Engineer")).toBe(
      "machine-learning",
    );
    expect(inferApplicationRoleFamily("Site Reliability Engineer")).toBe(
      "platform",
    );
    expect(
      await loadApplicationCooldownRules("user-1", {
        sameRoleDays: 0,
        now: NOW,
      }),
    ).toEqual([]);
    expect(store.findMany).not.toHaveBeenCalled();
  });

  it("infers common Chinese role families", () => {
    expect(inferApplicationRoleFamily("高级后端工程师")).toBe("backend");
    expect(inferApplicationRoleFamily("机器学习工程师")).toBe(
      "machine-learning",
    );
    expect(inferApplicationRoleFamily("产品经理")).toBe("product");
  });
});
