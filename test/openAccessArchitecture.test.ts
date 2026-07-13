import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const invitePaths = [
  "lib/server/access/accessRequestService.ts",
  "lib/server/auth/adminAccess.ts",
  "app/api/access-requests/route.ts",
  "app/api/admin/access-requests/route.ts",
  "app/api/admin/access-requests/[id]/route.ts",
  "app/(app)/admin/access/page.tsx",
  "app/(app)/admin/access/AdminAccessClient.tsx",
];

describe("open-access architecture", () => {
  it("contains no invitation request runtime", () => {
    for (const path of invitePaths) expect(existsSync(resolve(root, path))).toBe(false);
  });

  it("removes invitation objects through a forward migration", () => {
    const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      resolve(root, "prisma/migrations/20260713000000_drop_access_request/migration.sql"),
      "utf8",
    );
    expect(schema).not.toMatch(/\bAccessRequest(?:Status)?\b/);
    expect(migration).toContain('DROP TABLE IF EXISTS "AccessRequest";');
    expect(migration).toContain('DROP TYPE IF EXISTS "AccessRequestStatus";');
    expect(migration.indexOf("DROP TABLE")).toBeLessThan(migration.indexOf("DROP TYPE"));
  });
});
