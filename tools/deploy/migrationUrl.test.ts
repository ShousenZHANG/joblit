import { describe, expect, it } from "vitest";
import { isPooledConnectionUrl, resolveMigrationUrl } from "./migrationUrl.mjs";

/**
 * `prisma migrate deploy` takes a session-scoped advisory lock
 * (`pg_advisory_lock(72707369)`). A transaction-mode pooler hands each
 * statement to whichever backend is free, so the session that acquires the
 * lock is not the session that later checks it, and migrate waits out its
 * 10s timeout every time:
 *
 *   Timed out trying to acquire a postgres advisory lock
 *   (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
 *
 * Migrations therefore need the direct endpoint. The runtime client is
 * unaffected — it should keep using the pooled URL.
 */
describe("resolveMigrationUrl", () => {
  it("prefers the direct url when one is configured", () => {
    expect(
      resolveMigrationUrl({
        DIRECT_URL: "postgres://u@ep-x.eu-central-1.aws.neon.tech/db",
        DATABASE_URL: "postgres://u@ep-x-pooler.eu-central-1.aws.neon.tech/db",
      }),
    ).toBe("postgres://u@ep-x.eu-central-1.aws.neon.tech/db");
  });

  // The Neon and Vercel Postgres integrations already inject an unpooled URL
  // under their own names. Reading those means a correctly integrated project
  // needs no manual variable at all.
  it("accepts the name the Neon integration injects", () => {
    expect(
      resolveMigrationUrl({
        DATABASE_URL_UNPOOLED: "postgres://u@ep-x.aws.neon.tech/db",
        DATABASE_URL: "postgres://u@ep-x-pooler.aws.neon.tech/db",
      }),
    ).toBe("postgres://u@ep-x.aws.neon.tech/db");
  });

  it("accepts the name the Vercel Postgres integration injects", () => {
    expect(
      resolveMigrationUrl({
        POSTGRES_URL_NON_POOLING: "postgres://u@ep-x.aws.neon.tech/db",
        DATABASE_URL: "postgres://u@ep-x-pooler.aws.neon.tech/db",
      }),
    ).toBe("postgres://u@ep-x.aws.neon.tech/db");
  });

  it("prefers an explicit DIRECT_URL over an injected one", () => {
    expect(
      resolveMigrationUrl({
        DIRECT_URL: "postgres://u@explicit/db",
        DATABASE_URL_UNPOOLED: "postgres://u@injected/db",
        DATABASE_URL: "postgres://u@pooled-pooler.aws.neon.tech/db",
      }),
    ).toBe("postgres://u@explicit/db");
  });

  it("falls back to the runtime url when no direct url is set", () => {
    expect(
      resolveMigrationUrl({ DATABASE_URL: "postgres://u@host/db" }),
    ).toBe("postgres://u@host/db");
  });

  it("ignores a blank direct url rather than migrating against an empty string", () => {
    expect(
      resolveMigrationUrl({ DIRECT_URL: "   ", DATABASE_URL: "postgres://u@host/db" }),
    ).toBe("postgres://u@host/db");
  });

  it("returns undefined when neither is set, so Prisma reports its own error", () => {
    expect(resolveMigrationUrl({})).toBeUndefined();
  });
});

describe("isPooledConnectionUrl", () => {
  it.each([
    "postgres://u@ep-cool-name-pooler.eu-central-1.aws.neon.tech/db",
    "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech:5432/db?sslmode=require",
  ])("detects the Neon pooled endpoint %j", (url) => {
    expect(isPooledConnectionUrl(url)).toBe(true);
  });

  it.each([
    "postgres://u@ep-cool-name.eu-central-1.aws.neon.tech/db",
    "postgresql://u:p@db.internal:5432/joblit",
    "postgres://localhost:5432/joblit",
  ])("accepts the direct endpoint %j", (url) => {
    expect(isPooledConnectionUrl(url)).toBe(false);
  });

  it("detects pgbouncer declared as a query parameter", () => {
    expect(
      isPooledConnectionUrl("postgres://u@host/db?pgbouncer=true"),
    ).toBe(true);
  });

  it("treats an unparseable or missing url as not pooled", () => {
    // Prisma will report a missing or malformed url far better than a guess here.
    expect(isPooledConnectionUrl("not a url")).toBe(false);
    expect(isPooledConnectionUrl(undefined)).toBe(false);
  });
});
