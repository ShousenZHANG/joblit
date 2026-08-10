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

  it("still names an unclassified Prisma code instead of hiding it", () => {
    const result = classifyDatabaseError(prismaError("P9999"));
    expect(result).toMatchObject({
      code: "DATABASE_ERROR",
      status: 500,
      prismaCode: "P9999",
    });
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
