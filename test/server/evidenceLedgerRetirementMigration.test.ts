import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20260817090000_drop_evidence_ledger/migration.sql",
  ),
  "utf8",
);

/**
 * A destructive migration is the one kind of change no test can undo, so its
 * SQL is pinned here as text. The previous drop of this size shipped with no
 * transaction, no lock timeout and no test; this file exists so the next one
 * cannot.
 */
describe("evidence ledger retirement migration", () => {
  it("removes the ledger models, enum and denormalised column from Prisma", () => {
    expect(schema).not.toMatch(/^model EvidenceSnapshot\s*\{/m);
    expect(schema).not.toMatch(/^model ClaimEvidence\s*\{/m);
    expect(schema).not.toMatch(/^enum EvidenceKind\s*\{/m);
    expect(schema).not.toMatch(/^\s*reviewReport\s/m);
  });

  it("leaves no dangling relation fields on the surviving models", () => {
    expect(schema).not.toMatch(/evidenceSnapshots\s+EvidenceSnapshot\[\]/);
    expect(schema).not.toMatch(/claimEvidence\s+ClaimEvidence\[\]/);
  });

  it("drops the edge table before the table it restricts", () => {
    const edge = migration.indexOf('DROP TABLE IF EXISTS "ClaimEvidence"');
    const snapshot = migration.indexOf('DROP TABLE IF EXISTS "EvidenceSnapshot"');
    const enumDrop = migration.indexOf('DROP TYPE IF EXISTS "EvidenceKind"');
    expect(edge).toBeGreaterThan(-1);
    expect(edge).toBeLessThan(snapshot);
    expect(snapshot).toBeLessThan(enumDrop);
  });

  it("takes its ACCESS EXCLUSIVE locks inside a bounded transaction", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("SET LOCAL lock_timeout");
    expect(migration).toContain("COMMIT;");
    expect(migration.indexOf("SET LOCAL lock_timeout")).toBeLessThan(
      migration.indexOf('DROP TABLE IF EXISTS "ClaimEvidence"'),
    );
  });

  it("drops the review column the ledger denormalised into Application", () => {
    expect(migration).toContain(
      'ALTER TABLE "Application" DROP COLUMN IF EXISTS "reviewReport"',
    );
  });
});
