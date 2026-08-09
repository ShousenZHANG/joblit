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
  bulkAppendStatusEvents,
  appendApplicationEvent,
  isAllowedStatusTransition,
} from "@/lib/server/applications/applicationEvents";
import {
  canonicalJson,
  contentHash,
  stableClaimId,
  stableEvidenceId,
} from "@/lib/server/applications/evidenceHashing";

describe("application ledger invariants", () => {
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
    expect(isAllowedStatusTransition("NEW", "REJECTED")).toBe(true);
    expect(isAllowedStatusTransition("APPLIED", "REJECTED")).toBe(true);
    expect(isAllowedStatusTransition("REJECTED", "APPLIED")).toBe(true);
    expect(isAllowedStatusTransition("APPLIED", "APPLIED")).toBe(false);
  });

  it("never writes a status retired by the triage collapse", () => {
    for (const target of ["INTERVIEW", "OFFER", "WITHDRAWN", "ACCEPTED"] as const) {
      expect(isAllowedStatusTransition("NEW", target)).toBe(false);
      expect(isAllowedStatusTransition("APPLIED", target)).toBe(false);
    }
  });

  it("lets a row still holding a retired status move to an active one", () => {
    // The ledger keeps historic INTERVIEW/OFFER rows readable, and any Job row
    // the collapse migration missed must not be stranded.
    expect(isAllowedStatusTransition("INTERVIEW", "REJECTED")).toBe(true);
    expect(isAllowedStatusTransition("WITHDRAWN", "APPLIED")).toBe(true);
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
        where: { postingRisk: { gte: 80 } },
        fromStatus: "NEW",
        toStatus: "REJECTED",
        source: "USER",
        note: "Bulk ignored risky postings",
        idempotencyPrefix: "bulk-1",
        projectionUpdatedAt: changedAt,
      }),
    ).resolves.toEqual({ count: 2 });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        AND: [
          { postingRisk: { gte: 80 } },
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
