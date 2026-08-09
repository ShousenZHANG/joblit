import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/lib/generated/prisma";
import {
  acquireUnboundApplicationWriteAuthority,
  retireStaleStandaloneTailoringRuns,
  STALE_ISSUED_TAILORING_RUN_MS,
} from "./tailoringJobOwnership";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

function transaction() {
  return {
    $executeRaw: vi.fn(async () => 0),
    tailoringRun: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("Tailoring Job write ownership", () => {
  it("blocks an unbound Application write while a generation run is active", async () => {
    const tx = transaction();
    vi.mocked(tx.tailoringRun.findFirst).mockResolvedValue({
      id: RUN_ID,
    } as never);

    await expect(
      acquireUnboundApplicationWriteAuthority(tx, {
        userId: USER_ID,
        jobId: JOB_ID,
      }),
    ).rejects.toMatchObject({ code: "ATTEMPT_ACTIVE", status: 409 });

    expect(tx.tailoringRun.updateMany).not.toHaveBeenCalled();
    expect(vi.mocked(tx.$executeRaw).mock.calls[0]?.[1]).toBe(0x544a4f42);
  });

  it("locks and rechecks a stale standalone run before terminalizing it", async () => {
    const tx = transaction();
    const now = new Date("2026-08-09T12:00:00.000Z");
    vi.mocked(tx.tailoringRun.findMany).mockResolvedValue([
      { id: RUN_ID },
    ] as never);

    await retireStaleStandaloneTailoringRuns(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      now,
    });

    const lockCalls = vi.mocked(tx.$executeRaw).mock.calls;
    expect(lockCalls).toHaveLength(1);
    expect(lockCalls[0]?.[1]).toBe(0x544c524e);
    expect(tx.tailoringRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: [RUN_ID] },
        applicationBatchTaskId: null,
        acceptedTargetMask: 0,
        OR: [
          {
            status: "RUNNING",
            executionLeaseExpiresAt: { lte: now },
          },
          {
            status: "ISSUED",
            issuedAt: {
              lte: new Date(now.getTime() - STALE_ISSUED_TAILORING_RUN_MS),
            },
          },
        ],
      }),
      data: expect.objectContaining({
        status: "CANCELLED",
        terminalAt: now,
        executionLeaseExpiresAt: null,
      }),
    });
  });

  it("allows an unbound write after a stale standalone owner is fenced", async () => {
    const tx = transaction();
    const now = new Date("2026-08-09T12:00:00.000Z");
    vi.mocked(tx.tailoringRun.findMany).mockResolvedValue([
      { id: RUN_ID },
    ] as never);

    await acquireUnboundApplicationWriteAuthority(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      now,
    });

    const lockCalls = vi.mocked(tx.$executeRaw).mock.calls;
    expect(lockCalls.map((call) => call[1])).toEqual([0x544a4f42, 0x544c524e]);
    expect(tx.tailoringRun.findFirst).toHaveBeenCalledOnce();
  });
});
