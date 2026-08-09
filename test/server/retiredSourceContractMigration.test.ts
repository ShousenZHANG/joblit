import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20260809154500_drop_retired_source_tables/migration.sql",
  ),
  "utf8",
);
const postContractVerifier = readFileSync(
  resolve(
    root,
    "prisma/migrations/20260809161000_verify_post_retirement_inventory/migration.sql",
  ),
  "utf8",
);

describe("retired source contract migration", () => {
  it("removes the obsolete source models and enum from Prisma", () => {
    expect(schema).not.toMatch(/^model SourceHealth\s*\{/m);
    expect(schema).not.toMatch(/^model AtsBoardSource\s*\{/m);
    expect(schema).not.toMatch(/^enum SourceHealthStatus\s*\{/m);
  });

  it("fails closed until the Stage 1 data and Blob gates converge", () => {
    expect(migration).toContain('LOCK TABLE\n  "Application",');
    expect(migration).toContain("\"market\" = 'GLOBAL'");
    expect(migration).toContain("\"market\" IN ('CN', 'GLOBAL')");
    expect(migration).toContain(
      'artifact."state" IN (\n      \'STAGED\'::"ApplicationArtifactState"',
    );
    expect(migration).toContain("\"key\" = 'vercel-applications-v1'");
    expect(migration).toContain('"completedAt" IS NOT NULL');
  });

  it("drops tables before their enum in one fail-closed transaction", () => {
    const beginAt = migration.indexOf("BEGIN;");
    const atsDropAt = migration.indexOf('DROP TABLE "AtsBoardSource";');
    const healthDropAt = migration.indexOf('DROP TABLE "SourceHealth";');
    const enumDropAt = migration.indexOf('DROP TYPE "SourceHealthStatus";');
    const commitAt = migration.lastIndexOf("COMMIT;");

    expect(beginAt).toBeGreaterThanOrEqual(0);
    expect(atsDropAt).toBeGreaterThan(beginAt);
    expect(healthDropAt).toBeGreaterThan(atsDropAt);
    expect(enumDropAt).toBeGreaterThan(healthDropAt);
    expect(commitAt).toBeGreaterThan(enumDropAt);
    expect(migration).toContain("SET LOCAL lock_timeout = '15s';");
    expect(migration).toContain(
      'LOCK TABLE "AtsBoardSource", "SourceHealth" IN ACCESS EXCLUSIVE MODE;',
    );
    expect(migration).not.toMatch(
      /DROP\s+(?:TABLE|TYPE)\s+[^;]*\sCASCADE\s*;/i,
    );
  });

  it("verifies that all three database objects are absent", () => {
    expect(migration).toContain(
      `IF to_regclass('"AtsBoardSource"') IS NOT NULL`,
    );
    expect(migration).toContain(`OR to_regclass('"SourceHealth"') IS NOT NULL`);
    expect(migration).toContain(
      `OR to_regtype('"SourceHealthStatus"') IS NOT NULL`,
    );
  });

  it("requires a settled Blob inventory completed after the contract migration", () => {
    expect(postContractVerifier).toContain(
      `"migration_name" = '20260809154500_drop_retired_source_tables'`,
    );
    expect(postContractVerifier).toContain(
      `"completedAt" >= (\n          contract_finished_at AT TIME ZONE 'UTC'\n        )`,
    );
    expect(postContractVerifier).toContain('"cursor" IS NULL');
    expect(postContractVerifier).toContain('"claimId" IS NULL');
    expect(postContractVerifier).toContain('"claimLeaseExpiresAt" IS NULL');
    expect(postContractVerifier).toContain('"scanStartedAt" IS NULL');
  });

  it("rechecks legacy rows and active orphan artifacts before Stage 2 deploys", () => {
    expect(postContractVerifier).toContain("\"market\" = 'GLOBAL'");
    expect(postContractVerifier).toContain("\"market\" IN ('CN', 'GLOBAL')");
    expect(postContractVerifier).toContain(
      'artifact."state" IN (\n      \'STAGED\'::"ApplicationArtifactState"',
    );
    expect(postContractVerifier.trimStart()).toMatch(/^--[\s\S]*?\nBEGIN;/);
    expect(postContractVerifier.trimEnd()).toMatch(/COMMIT;$/);
  });
});
