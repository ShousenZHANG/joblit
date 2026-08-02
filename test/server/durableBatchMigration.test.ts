import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260802120000_durable_agent_batch_integrity/migration.sql",
  ),
  "utf8",
);
const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

describe("durable Agent batch integrity migration", () => {
  it("creates durable Fit ownership and one-active database guards", () => {
    expect(migration).toContain('CREATE TABLE "FitBatchClaim"');
    expect(migration).toContain('CREATE TABLE "FitBatchClaimItem"');
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "FitBatchClaim_one_active_per_user"[\s\S]*WHERE "status" = 'ACTIVE'/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "ApplicationBatch_one_active_per_user"[\s\S]*WHERE "status" IN \('QUEUED', 'RUNNING'\)/,
    );
  });

  it("repairs historical batch headers before enforcing the active index", () => {
    const stableSnapshotAt = migration.indexOf(
      'LOCK TABLE "ApplicationBatch", "ApplicationBatchTask"',
    );
    const reconcileAt = migration.indexOf(
      'WITH "application_batch_task_counts" AS',
    );
    const cancelEmptyAt = migration.indexOf(
      'UPDATE "ApplicationBatch"\nSET\n  "status" = \'CANCELLED\'',
    );
    const terminalizeStaleAt = migration.indexOf(
      'UPDATE "ApplicationBatch" AS batch\nSET\n  "status" = CASE',
    );
    const activeIndexAt = migration.indexOf(
      'CREATE UNIQUE INDEX "ApplicationBatch_one_active_per_user"',
    );

    expect(stableSnapshotAt).toBeGreaterThan(-1);
    expect(reconcileAt).toBeGreaterThan(stableSnapshotAt);
    expect(cancelEmptyAt).toBeGreaterThan(reconcileAt);
    expect(terminalizeStaleAt).toBeGreaterThan(cancelEmptyAt);
    expect(activeIndexAt).toBeGreaterThan(terminalizeStaleAt);
    expect(migration).toContain(
      'CREATE INDEX "ApplicationBatchTask_jobId_batchId_idx"',
    );
  });

  it("keeps legacy Job claim projections intact for exact-group adoption", () => {
    expect(migration).not.toMatch(/(?:UPDATE|DELETE FROM)\s+"Job"/);
  });

  it("maps the Fit lease index to the physical migration name", () => {
    const physicalIndexName = "FitBatchClaim_userId_status_lease_idx";

    expect(migration).toContain(`CREATE INDEX "${physicalIndexName}"`);
    expect(schema).toContain(
      `@@index([userId, status, executionLeaseExpiresAt], map: "${physicalIndexName}")`,
    );
  });
});
