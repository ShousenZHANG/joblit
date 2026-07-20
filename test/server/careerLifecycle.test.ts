import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  updateManyAndReturn: vi.fn(),
  createManyEvents: vi.fn(),
  jobFindFirst: vi.fn(),
  eventCreate: vi.fn(),
  jobUpdate: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: db.transaction },
}));
import {
  buildFunnelAnalytics,
  compareOffers,
} from "@/lib/server/career/analytics";
import {
  bulkAppendStatusEvents,
  appendApplicationEvent,
  isAllowedStatusTransition,
} from "@/lib/server/career/applicationEvents";
import {
  canonicalJson,
  contentHash,
  stableClaimId,
  stableEvidenceId,
} from "@/lib/server/career/hashing";
import {
  ApplicationEventCreateSchema,
  EvidenceCreateSchema,
} from "@/lib/server/career/schemas";

describe("career lifecycle invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: db.executeRaw,
        job: {
          findFirst: db.jobFindFirst,
          update: db.jobUpdate,
          updateManyAndReturn: db.updateManyAndReturn,
        },
        applicationEvent: {
          create: db.eventCreate,
          createMany: db.createManyEvents,
        },
      }),
    );
    db.eventCreate.mockResolvedValue({ id: "event-1" });
    db.jobUpdate.mockResolvedValue({ id: "job-a" });
    db.executeRaw.mockResolvedValue(1);
  });

  it("canonicalizes object keys before hashing evidence", () => {
    const left = { role: "Engineer", skills: ["TypeScript", "AWS"], years: 5 };
    const right = { years: 5, skills: ["TypeScript", "AWS"], role: "Engineer" };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(contentHash(left)).toBe(contentHash(right));
  });

  it("creates stable tenant-scoped evidence and claim ids", () => {
    const hash = contentHash({ fact: "Led a migration" });
    const first = stableEvidenceId("user-a", "USER_CLAIM", hash);
    expect(first).toMatch(/^ev_[a-f0-9]{32}$/);
    expect(stableEvidenceId("user-a", "USER_CLAIM", hash)).toBe(first);
    expect(stableEvidenceId("user-b", "USER_CLAIM", hash)).not.toBe(first);

    const claim = stableClaimId("user-a", "app-a", hash, first);
    expect(claim).toMatch(/^ce_[a-f0-9]{32}$/);
    expect(stableClaimId("user-a", "app-a", hash, first)).toBe(claim);
  });

  it("rejects values that cannot be canonical JSON", () => {
    expect(() => canonicalJson({ score: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalJson({ createdAt: new Date() })).toThrow("non-plain");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cycle");
  });

  it("enforces deliberate lifecycle transitions", () => {
    expect(isAllowedStatusTransition("NEW", "APPLIED")).toBe(true);
    expect(isAllowedStatusTransition("NEW", "INTERVIEW")).toBe(true);
    expect(isAllowedStatusTransition("NEW", "OFFER")).toBe(true);
    expect(isAllowedStatusTransition("APPLIED", "INTERVIEW")).toBe(true);
    expect(isAllowedStatusTransition("INTERVIEW", "OFFER")).toBe(true);
    expect(isAllowedStatusTransition("OFFER", "ACCEPTED")).toBe(true);
    expect(isAllowedStatusTransition("NEW", "ACCEPTED")).toBe(false);
    expect(isAllowedStatusTransition("ACCEPTED", "NEW")).toBe(false);
    expect(isAllowedStatusTransition("APPLIED", "APPLIED")).toBe(false);
  });

  it("requires a target status only for status-change events", () => {
    expect(
      ApplicationEventCreateSchema.safeParse({
        jobId: "13fd90f2-15e0-49fd-ad2c-ec2562714d69",
        type: "STATUS_CHANGED",
      }).success,
    ).toBe(false);
    expect(
      ApplicationEventCreateSchema.safeParse({
        jobId: "13fd90f2-15e0-49fd-ad2c-ec2562714d69",
        type: "NOTE_ADDED",
        toStatus: "APPLIED",
      }).success,
    ).toBe(false);
  });

  it("strictly validates evidence JSON and rejects unknown API fields", () => {
    expect(
      EvidenceCreateSchema.safeParse({
        kind: "USER_CLAIM",
        payload: { claim: "Built the migration", metric: 42 },
      }).success,
    ).toBe(true);
    expect(
      EvidenceCreateSchema.safeParse({
        kind: "USER_CLAIM",
        payload: { claim: "Built the migration" },
        admin: true,
      }).success,
    ).toBe(false);
  });

  it("writes bulk projections and immutable events in one transaction", async () => {
    db.updateManyAndReturn.mockResolvedValue([
      { id: "job-a", company: "Acme", title: "Backend Engineer" },
      { id: "job-b", company: "Globex", title: "Platform Engineer" },
    ]);
    db.createManyEvents.mockResolvedValue({ count: 2 });
    const changedAt = new Date("2026-07-20T05:00:00.000Z");

    await expect(
      bulkAppendStatusEvents("user-a", {
        where: { fitScore: { lte: 44 } },
        fromStatus: "NEW",
        toStatus: "REJECTED",
        source: "USER",
        note: "Bulk ignored low-fit roles",
        idempotencyPrefix: "bulk-1",
        projectionUpdatedAt: changedAt,
      }),
    ).resolves.toEqual({ count: 2 });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        AND: [
          { fitScore: { lte: 44 } },
          { userId: "user-a", status: "NEW" },
        ],
      },
      data: { status: "REJECTED", updatedAt: changedAt },
      select: { id: true, company: true, title: true },
    });
    expect(db.createManyEvents).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          jobId: "job-a",
          companySnapshot: "Acme",
          titleSnapshot: "Backend Engineer",
          fromStatus: "NEW",
          toStatus: "REJECTED",
          idempotencyKey: "bulk-1:job-a",
        }),
        expect.objectContaining({
          jobId: "job-b",
          companySnapshot: "Globex",
          titleSnapshot: "Platform Engineer",
          fromStatus: "NEW",
          toStatus: "REJECTED",
          idempotencyKey: "bulk-1:job-b",
        }),
      ],
    });
  });

  it("snapshots company and title when appending one event", async () => {
    db.jobFindFirst.mockResolvedValue({
      id: "job-a",
      status: "NEW",
      company: "Acme",
      title: "Backend Engineer",
    });

    await appendApplicationEvent("user-a", {
      jobId: "job-a",
      type: "STATUS_CHANGED",
      source: "USER",
      toStatus: "APPLIED",
      expectedFromStatus: "NEW",
    });

    expect(db.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-a",
        jobId: "job-a",
        companySnapshot: "Acme",
        titleSnapshot: "Backend Engineer",
        fromStatus: "NEW",
        toStatus: "APPLIED",
      }),
    });
  });
});

describe("career analytics", () => {
  it("calculates conversion and median velocity from first reached events", () => {
    const day = (value: number) => new Date(`2026-07-${String(value).padStart(2, "0")}T00:00:00.000Z`);
    const funnel = buildFunnelAnalytics(
      [
        { jobId: "job-1", toStatus: "APPLIED", occurredAt: day(1) },
        { jobId: "job-1", toStatus: "INTERVIEW", occurredAt: day(3) },
        { jobId: "job-1", toStatus: "OFFER", occurredAt: day(7) },
        { jobId: "job-1", toStatus: "ACCEPTED", occurredAt: day(8) },
        { jobId: "job-2", toStatus: "APPLIED", occurredAt: day(1) },
        { jobId: "job-2", toStatus: "REJECTED", occurredAt: day(5) },
      ],
      [
        { id: "job-1", status: "ACCEPTED" },
        { id: "job-2", status: "REJECTED" },
      ],
    );

    expect(funnel.counts).toMatchObject({
      applied: 2,
      interview: 1,
      offer: 1,
      accepted: 1,
      rejected: 1,
    });
    expect(funnel.conversion).toEqual({
      appliedToInterview: 0.5,
      interviewToOffer: 1,
      offerToAccepted: 1,
    });
    expect(funnel.medianDays).toEqual({
      appliedToInterview: 2,
      interviewToOffer: 4,
      offerToAccepted: 1,
    });
  });

  it("never compares offers across currencies", () => {
    const comparison = compareOffers([
      {
        id: "aud",
        company: "A",
        role: "Engineer",
        currency: "AUD",
        baseSalaryAnnual: 150_000,
        bonusAnnual: 10_000,
        equityAnnual: 0,
        otherAnnual: 0,
        targetSalaryAnnual: 170_000,
      },
      {
        id: "usd",
        company: "B",
        role: "Engineer",
        currency: "USD",
        baseSalaryAnnual: 140_000,
        bonusAnnual: null,
        equityAnnual: null,
        otherAnnual: null,
        targetSalaryAnnual: 160_000,
      },
    ]);

    expect(comparison.crossCurrencyComparison).toBe(false);
    expect(comparison.currencies.map((group) => group.currency)).toEqual([
      "AUD",
      "USD",
    ]);
    expect(comparison.currencies[0].offers[0]).toMatchObject({
      totalAnnual: 160_000,
      salaryGap: 10_000,
      incomplete: false,
    });
    expect(comparison.currencies[1].offers[0]).toMatchObject({
      incomplete: true,
      salaryGap: null,
    });
  });
});
