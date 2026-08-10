import { describe, expect, it } from "vitest";
import { classifyDatabaseError } from "./databaseError";

/**
 * The status code IS the contract with the Runner: it replays a receipt on 5xx
 * and stops on 4xx. Prisma errors used to reach it as a bodyless 500, so a
 * unique-constraint violation — which no retry can fix — was replayed three
 * times and parked the queue, while a pool timeout, which retrying WOULD fix,
 * looked exactly the same. These tests pin the split, not the prose.
 */

function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma said ${code}`), { code });
}

describe("classifyDatabaseError", () => {
  it("marks a connection-pool timeout retryable", () => {
    // P2024 is the one that matches the production signature: the import path
    // held a transaction with Prisma's default 2s connection wait while a
    // batch was draining.
    const result = classifyDatabaseError(prismaError("P2024"));
    expect(result).toMatchObject({ code: "DATABASE_UNAVAILABLE", status: 503 });
  });

  it("marks a constraint violation permanent", () => {
    const result = classifyDatabaseError(prismaError("P2002"));
    expect(result).toMatchObject({ code: "DATABASE_CONFLICT", status: 409 });
    expect(result!.status).toBeLessThan(500);
  });

  it("treats an unclassified Prisma code as deterministic, not retryable", () => {
    // The first version answered 500 here, reasoning that an unknown failure
    // might have committed. But the Runner replays every 5xx, so a
    // deterministic error it cannot fix loops forever and parks the queue —
    // which is what production then did, seven passes running, with exactly
    // this code. Anything outside the small enumerable set of transient Prisma
    // codes is a decision, and must stop the client.
    const result = classifyDatabaseError(prismaError("P9999"));
    expect(result).toMatchObject({
      code: "DATABASE_ERROR",
      prismaCode: "P9999",
    });
    expect(result!.status).toBeLessThan(500);
  });

  it("keeps every known-deterministic write failure below 500", () => {
    // Each of these is a rejection of the data itself. Replaying any of them
    // burns three attempts and defers the task, forever.
    for (const code of [
      "P2000", // value too long
      "P2011", // null constraint
      "P2012", // missing required value
      "P2014", // required relation violated
      "P2023", // inconsistent column data
    ]) {
      expect(
        classifyDatabaseError(prismaError(code))!.status,
        code,
      ).toBeLessThan(500);
    }
  });

  it("keeps the transient set retryable so a pool blip is not a hard failure", () => {
    for (const code of ["P2024", "P1001", "P1017", "P2034"]) {
      expect(
        classifyDatabaseError(prismaError(code))!.status,
        code,
      ).toBeGreaterThanOrEqual(500);
    }
  });

  it("never leaks the database's own message to a client", () => {
    // Prisma messages name tables, columns and constraint names.
    const err = Object.assign(
      new Error('Unique constraint failed on the fields: (`userId`,`jobId`)'),
      { code: "P2002" },
    );
    const result = classifyDatabaseError(err);
    expect(result!.message).not.toContain("userId");
    expect(result!.message).not.toContain("constraint failed");
  });

  it("ignores an error that merely has a code", () => {
    // Coded application errors are rendered by isCodedError above this. Only
    // the P#### shape is Prisma's.
    expect(
      classifyDatabaseError(
        Object.assign(new Error("nope"), { code: "NOT_FOUND", status: 404 }),
      ),
    ).toBeNull();
    expect(classifyDatabaseError(new TypeError("boom"))).toBeNull();
    expect(classifyDatabaseError("P2002")).toBeNull();
  });
});
