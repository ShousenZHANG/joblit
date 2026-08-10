/**
 * Translate a Prisma failure into the canonical error envelope.
 *
 * Every database error used to fall through `isCodedError`, which requires
 * both a `code` and a numeric `status`. Prisma's errors carry `code` ("P2024",
 * "P2002", …) and no `status`, so all of them — transient and permanent alike
 * — became a bodyless 500. An agent client cannot tell that from a dropped
 * connection, so it replayed its receipt three times, deferred, and parked the
 * queue. A pool timeout and a unique-constraint violation are opposite
 * problems and were indistinguishable in production.
 *
 * The split that matters is retryability, because the status code IS the
 * contract with the Runner: it replays on 5xx and stops on 4xx.
 */

/** Infrastructure. The same request may well succeed later. */
const RETRYABLE_PRISMA_CODES = new Set([
  "P2024", // Timed out fetching a connection from the pool
  "P1001", // Cannot reach database server
  "P1002", // Database server timed out
  "P1008", // Operation timed out
  "P1017", // Server has closed the connection
  "P2034", // Transaction failed due to a write conflict or deadlock; retry
]);

/**
 * A decision the data has already made. Retrying changes nothing.
 *
 * This list is documentation, not the safety net — see the default below.
 */
const PERMANENT_PRISMA_CODES = new Set([
  "P2000", // Value too long for the column
  "P2002", // Unique constraint failed
  "P2003", // Foreign key constraint failed
  "P2004", // A database constraint failed
  "P2005", // Invalid value for the field type
  "P2006", // Invalid value for the model field
  "P2011", // Null constraint violation
  "P2012", // Missing a required value
  "P2013", // Missing a required argument
  "P2014", // The change would violate a required relation
  "P2019", // Input error
  "P2020", // Value out of range for the type
  "P2023", // Inconsistent column data
  "P2025", // Required record not found
  "P2033", // Number out of range for a 64-bit integer
]);

type PrismaLikeError = Error & { code: string; meta?: unknown };

function isPrismaLikeError(err: unknown): err is PrismaLikeError {
  return (
    err instanceof Error &&
    typeof (err as Partial<PrismaLikeError>).code === "string" &&
    /^P\d{4}$/.test((err as PrismaLikeError).code)
  );
}

export type DatabaseErrorClassification = {
  /** Stable, greppable code. Never the raw Prisma code — that leaks schema. */
  code: "DATABASE_UNAVAILABLE" | "DATABASE_CONFLICT" | "DATABASE_ERROR";
  status: number;
  message: string;
  /** The Prisma code, for the server log only. */
  prismaCode: string;
};

/**
 * Classify a Prisma error, or return null when it is not one.
 *
 * The message is deliberately generic: Prisma's own messages name tables,
 * columns and constraint names, and those must not reach a client.
 */
export function classifyDatabaseError(
  err: unknown,
): DatabaseErrorClassification | null {
  if (!isPrismaLikeError(err)) return null;

  if (RETRYABLE_PRISMA_CODES.has(err.code)) {
    return {
      code: "DATABASE_UNAVAILABLE",
      status: 503,
      message: "The database is temporarily unavailable. Please try again.",
      prismaCode: err.code,
    };
  }
  if (PERMANENT_PRISMA_CODES.has(err.code)) {
    return {
      code: "DATABASE_CONFLICT",
      status: 409,
      message:
        "This change conflicts with data that already exists. Reload and try again.",
      prismaCode: err.code,
    };
  }
  // An unclassified Prisma code defaults to DETERMINISTIC, not retryable.
  //
  // The first version of this defaulted to 500, reasoning that an unknown
  // failure might have committed. That reasoning ignored the cost asymmetry a
  // 5xx carries here: the Runner replays a 5xx, so a deterministic error it
  // cannot fix loops forever and parks the queue — which is exactly what
  // production then did, seven passes running, with this very code. Getting a
  // transient error wrong costs one task the user can queue again; getting a
  // permanent one wrong costs the queue. Prisma's transient codes are few and
  // enumerable, so anything outside that set is treated as a decision.
  //
  // The Prisma code ships in `details`. The code names an error class and
  // leaks nothing about the schema — that is Prisma's MESSAGE, which is why
  // only the code travels — and without it the next failure is another round
  // trip through the platform log.
  return {
    code: "DATABASE_ERROR",
    status: 422,
    message:
      "The database rejected this change. It will not succeed on a retry.",
    prismaCode: err.code,
  };
}
