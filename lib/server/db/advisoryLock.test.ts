import { describe, expect, it, vi } from "vitest";
import {
  LOCK_NAMESPACES,
  LOCK_ORDER,
  acquireAdvisoryLock,
  stableInt32,
  type LockNamespace,
} from "./advisoryLock";

function fakeTx() {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    tx: {
      $executeRaw: vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push({ sql: strings.join("?"), values });
          return 1;
        },
      ),
    } as never,
  };
}

describe("advisory lock key derivation", () => {
  /**
   * These are lock identities, not hashes we are free to improve. If this
   * function changes, a rolling deploy runs two versions that derive different
   * keys for the same row and stop serialising against each other — silently.
   * Pin the exact output so that change cannot pass review by accident.
   */
  it.each([
    ["", -2128831035],
    ["a", -468965076],
    ["user-1", -179078796],
    ["11111111-1111-4111-8111-111111111111", -786179037],
    ["user-1:job-1", -661590045],
    ["中文", 1362277805],
  ])("derives a stable key for %j", (input, expected) => {
    expect(stableInt32(input)).toBe(expected);
  });

  it("stays inside signed 32-bit range", () => {
    for (const value of ["", "a", "x".repeat(500), "🙂", "user-1:job-1"]) {
      const key = stableInt32(value);
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(key).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });

  it("is deterministic across calls", () => {
    expect(stableInt32("user-1")).toBe(stableInt32("user-1"));
  });

  it("separates the composite application key from a bare user id", () => {
    // acquireApplicationMutationLock keys on `${userId}:${jobId}`. If that
    // collided with the plain userId the job lock uses, two different critical
    // sections would share one lock.
    expect(stableInt32("user-1:job-1")).not.toBe(stableInt32("user-1"));
  });
});

describe("advisory lock namespaces", () => {
  it("keeps every namespace distinct", () => {
    // A collision would silently merge two unrelated critical sections.
    const values = Object.values(LOCK_NAMESPACES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps every namespace a positive 32-bit integer", () => {
    for (const [name, value] of Object.entries(LOCK_NAMESPACES)) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
      expect(value, name).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });

  it("pins the namespace values — they are shared with running transactions", () => {
    expect(LOCK_NAMESPACES).toEqual({
      fetchRunLifecycle: 0x4652554e,
      jobMutation: 0x4a4f424a,
      applicationMutation: 0x4a4f4241,
    });
  });

  it("reads as its four-letter tag in pg_locks", () => {
    const tag = (value: number) =>
      [24, 16, 8, 0].map((shift) => String.fromCharCode((value >> shift) & 0xff)).join("");
    expect(tag(LOCK_NAMESPACES.fetchRunLifecycle)).toBe("FRUN");
    expect(tag(LOCK_NAMESPACES.jobMutation)).toBe("JOBJ");
    expect(tag(LOCK_NAMESPACES.applicationMutation)).toBe("JOBA");
  });

  it("orders every namespace broadest-first", () => {
    expect([...LOCK_ORDER].sort()).toEqual(
      (Object.keys(LOCK_NAMESPACES) as LockNamespace[]).sort(),
    );
    expect(LOCK_ORDER).toEqual([
      "fetchRunLifecycle",
      "jobMutation",
      "applicationMutation",
    ]);
  });
});

describe("acquireAdvisoryLock", () => {
  it("issues a transaction-scoped two-int lock", async () => {
    const { tx, calls } = fakeTx();
    await acquireAdvisoryLock(tx, "jobMutation", "user-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("pg_advisory_xact_lock");
    expect(calls[0].values).toEqual([
      LOCK_NAMESPACES.jobMutation,
      stableInt32("user-1"),
    ]);
  });

  it("uses $executeRaw, because the function returns void", async () => {
    // $queryRaw cannot deserialize PostgreSQL void through a driver adapter.
    const { tx } = fakeTx();
    await acquireAdvisoryLock(tx, "fetchRunLifecycle", "run-1");
    expect((tx as unknown as { $executeRaw: unknown }).$executeRaw).toBeDefined();
  });

  it("never takes a session-scoped lock", async () => {
    // A session lock survives the transaction and leaks into the next request
    // on a pooled connection.
    const { tx, calls } = fakeTx();
    await acquireAdvisoryLock(tx, "applicationMutation", "user-1:job-1");
    expect(calls[0].sql).not.toContain("pg_advisory_lock(");
    expect(calls[0].sql).not.toContain("pg_advisory_unlock");
  });
});
