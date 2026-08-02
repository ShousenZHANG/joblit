import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/ci.yml"),
  "utf8",
);

describe("CI workflow dependency order", () => {
  it("installs dependencies before Knip loads workspace configs", () => {
    const rootInstall = workflow.indexOf("- name: Install dependencies");
    const deadCodeGate = workflow.indexOf(
      "- name: Dead-code and dependency gate",
    );

    expect(rootInstall).toBeGreaterThan(-1);
    expect(deadCodeGate).toBeGreaterThan(-1);
    expect(rootInstall).toBeLessThan(deadCodeGate);
  });

  it("replays every post-contract migration before checking legacy drift", () => {
    const contractMigration = workflow.indexOf(
      'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260731140000_drop_extension_token_and_legacy_artifact_uniques/migration.sql',
    );
    const replayLoop = workflow.indexOf(
      "replay_post_contract_migrations=false",
      contractMigration,
    );
    const finalDriftCheck = workflow.indexOf(
      "npx prisma migrate diff --from-schema=prisma/schema.prisma --to-config-datasource --exit-code",
      replayLoop,
    );

    expect(contractMigration).toBeGreaterThan(-1);
    expect(replayLoop).toBeGreaterThan(contractMigration);
    expect(finalDriftCheck).toBeGreaterThan(replayLoop);

    const replayStep = workflow.slice(replayLoop, finalDriftCheck);
    expect(replayStep).toContain(
      'if [ "$replay_post_contract_migrations" = true ]; then',
    );
    expect(replayStep).toContain(
      'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"',
    );
  });
});
