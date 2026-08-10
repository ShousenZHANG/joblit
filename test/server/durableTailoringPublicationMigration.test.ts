import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20260810113000_durable_tailoring_publication/migration.sql",
  ),
  "utf8",
);
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");

describe("durable Tailoring Run publication migration", () => {
  it("applies the publication contract atomically with a bounded lock wait", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*?\nBEGIN;/);
    expect(migration).toContain("SET LOCAL lock_timeout = '15s';");
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
  });

  it("adds zero-defaulted publication masks to existing Tailoring Runs", () => {
    expect(migration).toMatch(
      /ADD COLUMN "publicationRequiredTargetMask" INTEGER NOT NULL DEFAULT 0/,
    );
    expect(migration).toMatch(
      /ADD COLUMN "publishedTargetMask" INTEGER NOT NULL DEFAULT 0/,
    );
    expect(schema).toMatch(
      /publicationRequiredTargetMask\s+Int\s+@default\(0\)/,
    );
    expect(schema).toMatch(/publishedTargetMask\s+Int\s+@default\(0\)/);
  });

  it("guards publication masks and requires every publication before success", () => {
    expect(migration).toMatch(
      /"publicationRequiredTargetMask" BETWEEN 0 AND 3/,
    );
    expect(migration).toMatch(
      /\("publicationRequiredTargetMask" & "requiredTargetMask"\)\s*=\s*"publicationRequiredTargetMask"/,
    );
    expect(migration).toMatch(/"publishedTargetMask" BETWEEN 0 AND 3/);
    expect(migration).toMatch(
      /\("publishedTargetMask" & "acceptedTargetMask"\)\s*=\s*"publishedTargetMask"/,
    );
    expect(migration).toMatch(
      /\("publishedTargetMask" & "publicationRequiredTargetMask"\)\s*=\s*"publishedTargetMask"/,
    );
    expect(migration).toMatch(
      /"status" = 'SUCCEEDED'[\s\S]*"acceptedTargetMask" = "requiredTargetMask"[\s\S]*"publishedTargetMask" = "publicationRequiredTargetMask"/,
    );
  });

  it("allows negotiated protocol v2 without weakening legacy completion proof", () => {
    expect(migration).toMatch(
      /"tailoringProtocolVersion" IN \(0, 1, 2\)/,
    );
    expect(migration).toMatch(
      /"tailoringProtocolVersion" IN \(1, 2\)[\s\S]*"status" = 'SUCCEEDED'[\s\S]*"completionAttemptId" = "executionAttemptId"/,
    );
    expect(migration).toMatch(
      /"tailoringProtocolVersion" = 0[\s\S]*"completionAttemptId" IS NULL/,
    );
  });

  it("stores one immutable publication receipt per run target", () => {
    expect(migration).toContain(
      'CREATE TABLE "TailoringRunPublicationReceipt"',
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "TailoringRunPublicationReceipt_runId_target_key"\s+ON "TailoringRunPublicationReceipt"\("runId", "target"\)/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "TailoringRunPublicationReceipt_runId_fkey"[\s\S]*REFERENCES "TailoringRun"\("id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "TailoringRunPublicationReceipt_applicationId_fkey"[\s\S]*REFERENCES "Application"\("id"\)[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/,
    );
    expect(schema).toMatch(
      /model TailoringRunPublicationReceipt \{[\s\S]*@@unique\(\[runId, target\]\)[\s\S]*\}/,
    );
  });
});
