import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260726120000_application_artifact_lifecycle",
    "migration.sql",
  ),
  "utf8",
);

const reconciliationMigration = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260731130000_agent_runtime_expand_and_artifact_reconciliation",
    "migration.sql",
  ),
  "utf8",
);

const schemaConvergenceMigration = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260731135000_schema_convergence_expand",
    "migration.sql",
  ),
  "utf8",
);

const agentContractMigration = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260731140000_drop_extension_token_and_legacy_artifact_uniques",
    "migration.sql",
  ),
  "utf8",
);

type LegacyIdentityCase = {
  name: string;
  url: string;
  expectedStoreHost: string | null;
  expectedStorageIdentity: string;
};

function projectLegacyIdentity(url: string): {
  storeHost: string | null;
  storageIdentity: string;
} {
  const trimmedUrl = url.trim();
  const match = trimmedUrl.match(/^https?:\/\/([^/?#]+)(?:\/(.*))?$/i);
  if (!match) {
    return {
      storeHost: null,
      storageIdentity: `legacy:${trimmedUrl}`,
    };
  }

  const candidateStoreHost = match[1]!.split(":", 1)[0]!.toLowerCase();
  const encodedPathname = (match[2] ?? "")
    .split(/[?#]/, 1)[0]!
    .replace(/^\/+/, "");
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(encodedPathname);
  } catch {
    decodedPathname = encodedPathname;
  }
  decodedPathname = decodedPathname.replace(/^\/+/, "");

  const validHost =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      candidateStoreHost,
    );
  const canonical =
    validHost &&
    decodedPathname.trim().length > 0;

  return canonical
    ? {
        storeHost: candidateStoreHost,
        storageIdentity: `${candidateStoreHost}/${decodedPathname}`,
      }
    : {
        storeHost: null,
        storageIdentity: `legacy:${trimmedUrl}`,
      };
}

const legacyIdentityCases: LegacyIdentityCase[] = [
  {
    name: "root URL",
    url: "https://blob.example/",
    expectedStoreHost: null,
    expectedStorageIdentity: "legacy:https://blob.example/",
  },
  {
    name: "empty authority host",
    url: "https://:443/applications/resume.pdf",
    expectedStoreHost: null,
    expectedStorageIdentity:
      "legacy:https://:443/applications/resume.pdf",
  },
  {
    name: "invalid UTF-8 percent sequence",
    url: "https://blob.example/applications/%FF.pdf",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/%FF.pdf",
  },
  {
    name: "malformed percent escape",
    url: "https://blob.example/applications/%GG.pdf",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/%GG.pdf",
  },
  {
    name: "truncated one-character percent escape",
    url: "https://blob.example/applications/resume%",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/resume%",
  },
  {
    name: "truncated two-character percent escape",
    url: "https://blob.example/applications/resume%A",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/resume%A",
  },
  {
    name: "canonical base URL",
    url: "https://BLOB.EXAMPLE/applications/resume%20one.pdf",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/resume one.pdf",
  },
  {
    name: "redundant leading pathname slashes",
    url: "https://blob.example///applications/resume%20one.pdf?download=1",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/resume one.pdf",
  },
  {
    name: "percent-encoded leading pathname slash",
    url: "https://blob.example/%2Fapplications/resume%20one.pdf",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/resume one.pdf",
  },
  {
    name: "query and fragment alias",
    url: "https://blob.example/applications/resume%20one.pdf?download=1#page=1",
    expectedStoreHost: "blob.example",
    expectedStorageIdentity: "blob.example/applications/resume one.pdf",
  },
];

describe("application artifact lifecycle migration contract", () => {
  it("creates constrained lifecycle and fenced checkpoint state", () => {
    expect(migration).toContain(
      'CONSTRAINT "ApplicationArtifact_state_projection_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "ApplicationArtifact_storage_identity_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "ApplicationArtifact_identity_format_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "ApplicationArtifact_provisional_identity_check"',
    );
    expect(migration).toContain(
      'CREATE TABLE "ApplicationArtifactInventoryCheckpoint"',
    );
    expect(migration).toContain(
      '"ApplicationArtifactInventoryCheckpoint_claim_pair_check"',
    );
    expect(migration).toContain(
      '"ApplicationArtifactInventoryCheckpoint_cursor_scan_check"',
    );
    expect(migration).toContain("'vercel-applications-v1'");
  });

  it("deduplicates backfill by lower host plus decoded pathname without pgcrypto", () => {
    expect(migration).toContain("pg_temp.joblit_percent_decode");
    expect(migration).toContain('lower(split_part(');
    expect(migration).toContain(
      '"candidateStoreHost" || \'/\' || "decodedPathname"',
    );
    expect(migration).toContain('SELECT DISTINCT ON ("storageIdentity")');
    expect(migration).toContain(
      "WHEN character_not_in_repertoire OR untranslatable_character",
    );
    expect(migration).not.toMatch(/\bdigest\s*\(/i);
    expect(migration).not.toMatch(/pgcrypto/i);
  });

  it.each(legacyIdentityCases)(
    "projects $name without violating the store-host/identity pair",
    ({ url, expectedStoreHost, expectedStorageIdentity }) => {
      expect(projectLegacyIdentity(url)).toEqual({
        storeHost: expectedStoreHost,
        storageIdentity: expectedStorageIdentity,
      });
    },
  );

  it("normalizes invalid host/path candidates and preserves encoded-path fallback", () => {
    expect(migration).toContain('"isCanonicalIdentity"');
    expect(migration).toMatch(
      /"candidateStoreHost" IS NOT NULL\s+AND "candidateStoreHost" ~\s+'[^']+'\s+AND "decodedPathname" IS NOT NULL\s+AND btrim\("decodedPathname"\) <> ''\s+\) AS "isCanonicalIdentity"/,
    );
    expect(migration).toMatch(
      /CASE\s+WHEN "isCanonicalIdentity"\s+THEN "candidateStoreHost"\s+ELSE NULL\s+END AS "storeHost"/,
    );
    expect(migration).toMatch(
      /CASE\s+WHEN "isCanonicalIdentity"\s+THEN "candidateStoreHost" \|\| '\/' \|\| "decodedPathname"\s+ELSE 'legacy:' \|\| "url"\s+END AS "storageIdentity"/,
    );
    expect(migration).toMatch(
      /WHEN character_not_in_repertoire OR untranslatable_character THEN\s+RETURN value;/,
    );
    expect(migration).toMatch(
      /IF substr\(value, index, 1\) = '%' THEN\s+IF index \+ 2 > char_length\(value\) THEN\s+RETURN value;\s+END IF;\s+pair := substr\(value, index \+ 1, 2\);\s+IF pair !~ '\^\[0-9A-Fa-f\]\{2\}\$' THEN\s+RETURN value;/,
    );
    expect(migration).toContain(
      "'^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+/*'",
    );
    expect(migration).toMatch(
      /pg_temp\.joblit_percent_decode\([\s\S]*?\),\s*'\^\/\+',\s*''\s*\)/,
    );
  });

  it("indexes live pointers and state-specific bounded candidate scans", () => {
    for (const field of [
      "resumePdfUrl",
      "coverPdfUrl",
      "resumeTexUrl",
      "coverTexUrl",
    ]) {
      expect(migration).toContain(
        `ON "Application"("${field}")\n  WHERE "${field}" IS NOT NULL`,
      );
    }
    expect(migration).toContain(
      '"ApplicationArtifact_staged_candidate_idx"',
    );
    expect(migration).toContain(
      `WHERE "state" = 'STAGED'`,
    );
    expect(migration).toContain(
      '"ApplicationArtifact_deleting_lease_candidate_idx"',
    );
    expect(migration).toContain(
      `WHERE "state" = 'DELETING'`,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ApplicationArtifact_storageIdentity_key"',
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "ApplicationArtifact_pathname_key"',
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "ApplicationArtifact_url_key"',
    );
  });
});

describe("agent runtime and artifact reconciliation migration", () => {
  it("is an atomic, bounded migration with artifact writers fenced", () => {
    expect(reconciliationMigration.trimStart()).toMatch(
      /^--[\s\S]*?\nBEGIN;/,
    );
    expect(reconciliationMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(reconciliationMigration).toContain(
      "SET LOCAL lock_timeout = '15s'",
    );
    expect(reconciliationMigration).toContain(
      "SET LOCAL statement_timeout = '5min'",
    );
    expect(reconciliationMigration).toContain(
      'LOCK TABLE "ApplicationArtifact" IN SHARE ROW EXCLUSIVE MODE',
    );
  });

  it("adds replacement identity uniqueness without contracting legacy writers", () => {
    const storageIdentity = reconciliationMigration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationArtifact_storageIdentity_key"',
    );
    const provisionalIdentity = reconciliationMigration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationArtifact_provisionalIdentity_key"',
    );

    expect(storageIdentity).toBeGreaterThan(-1);
    expect(provisionalIdentity).toBeGreaterThan(storageIdentity);
    expect(reconciliationMigration).not.toContain(
      'DROP INDEX IF EXISTS "ApplicationArtifact_pathname_key"',
    );
    expect(reconciliationMigration).not.toContain(
      'DROP INDEX IF EXISTS "ApplicationArtifact_url_key"',
    );
  });

  it("refuses pre-existing credential and receipt lookalike tables", () => {
    expect(reconciliationMigration).toContain(
      'CREATE TABLE "AgentCredential"',
    );
    expect(reconciliationMigration).toContain(
      'CREATE TABLE "FitBatchImportReceipt"',
    );
    expect(reconciliationMigration).not.toContain(
      'CREATE TABLE IF NOT EXISTS "AgentCredential"',
    );
    expect(reconciliationMigration).not.toContain(
      'CREATE TABLE IF NOT EXISTS "FitBatchImportReceipt"',
    );
  });

  it("fails closed when an idempotent object has the wrong shape", () => {
    expect(reconciliationMigration).toContain(
      "AgentCredential constraints do not match v1 contract",
    );
    expect(reconciliationMigration).toContain(
      "ApplicationArtifact identity unique indexes are invalid",
    );
    expect(reconciliationMigration).toContain(
      "Artifact inventory checkpoint contract is incomplete",
    );
    expect(reconciliationMigration).toContain(
      "Artifact inventory checkpoint columns are invalid",
    );
    expect(reconciliationMigration).toContain(
      "Artifact inventory checkpoint defaults are invalid",
    );
    expect(reconciliationMigration).toContain(
      "Artifact inventory checkpoint seed is missing",
    );
    for (const indexedColumn of [
      "tokenHash",
      "userId",
      "issueKey",
      "storageIdentity",
      "provisionalIdentity",
    ]) {
      expect(reconciliationMigration).toContain(
        `pg_get_indexdef(indexrelid, ${
          indexedColumn === "issueKey" ? 2 : 1
        }, TRUE) = '"${indexedColumn}"'`,
      );
    }
    expect(reconciliationMigration).toContain("indpred IS NULL");
    expect(reconciliationMigration).toContain("indexprs IS NULL");
  });
});

describe("agent runtime contract migration", () => {
  it("is atomic and refuses to wait indefinitely for old writers", () => {
    expect(agentContractMigration.trimStart()).toMatch(/^--[\s\S]*?\nBEGIN;/);
    expect(agentContractMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(agentContractMigration).toContain(
      "SET LOCAL lock_timeout = '15s'",
    );
    expect(agentContractMigration).toContain(
      "SET LOCAL statement_timeout = '5min'",
    );
    expect(agentContractMigration).toContain(
      'LOCK TABLE "ExtensionToken" IN ACCESS EXCLUSIVE MODE',
    );
    expect(agentContractMigration).toContain(
      'LOCK TABLE "AgentCredential" IN ACCESS SHARE MODE',
    );
  });

  it("proves replacement artifact identities before removing legacy uniqueness", () => {
    for (const index of [
      "ApplicationArtifact_storageIdentity_key",
      "ApplicationArtifact_provisionalIdentity_key",
      "ApplicationArtifact_pathname_idx",
      "ApplicationArtifact_url_idx",
    ]) {
      expect(agentContractMigration).toContain(`to_regclass('"${index}"')`);
    }
    expect(agentContractMigration).toContain(
      "ApplicationArtifact replacement indexes are invalid",
    );
    expect(agentContractMigration).toContain(
      "ApplicationArtifact identity checks are invalid",
    );
    expect(agentContractMigration).toContain(
      "ApplicationArtifact legacy pathname index has an unexpected shape",
    );
    expect(agentContractMigration).toContain(
      "ApplicationArtifact legacy URL index has an unexpected shape",
    );
  });

  it("drops only the retired credential table and validated legacy indexes", () => {
    expect(agentContractMigration).toContain('DROP TABLE "ExtensionToken";');
    expect(agentContractMigration).not.toContain(
      'DROP TABLE "ExtensionToken" CASCADE',
    );
    expect(agentContractMigration).toContain(
      'DROP INDEX IF EXISTS "ApplicationArtifact_pathname_key"',
    );
    expect(agentContractMigration).toContain(
      'DROP INDEX IF EXISTS "ApplicationArtifact_url_key"',
    );
    expect(agentContractMigration).toContain(
      "Agent runtime contract migration did not converge",
    );
  });
});

describe("historical schema convergence migration", () => {
  it("is expand-only and verifies both repaired defaults", () => {
    expect(schemaConvergenceMigration.trimStart()).toMatch(
      /^--[\s\S]*?\nBEGIN;/,
    );
    expect(schemaConvergenceMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(schemaConvergenceMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "locale" TEXT',
    );
    expect(schemaConvergenceMigration).toContain(
      'ALTER COLUMN "locale" SET NOT NULL',
    );
    expect(schemaConvergenceMigration).toContain(
      'ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP',
    );
    expect(schemaConvergenceMigration).toContain(
      "Application.locale did not converge",
    );
    expect(schemaConvergenceMigration).toContain(
      "ActiveResumeProfile.updatedAt default did not converge",
    );
    expect(schemaConvergenceMigration).not.toMatch(
      /\bDROP\s+(?:TABLE|COLUMN|INDEX|TYPE)\b/i,
    );
  });
});
