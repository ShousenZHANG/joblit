import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));

import {
  ApplicationArtifactConflictError,
  buildImmutableApplicationArtifactPath,
  canonicalizeApplicationArtifactStorageIdentity,
  enqueueApplicationArtifactRetirements,
  markArtifactsReferencedAndRetireSuperseded,
  parseApplicationArtifactPathname,
  prepareApplicationArtifactsForAccountErasure,
  purgeDeletedApplicationArtifactsForErasedUser,
  recordUploadedArtifact,
  retireStagedArtifacts,
  stageApplicationArtifact as stageArtifact,
  type ApplicationArtifactDatabase,
  type ApplicationArtifactRecord,
  type ApplicationArtifactTransaction,
} from "./applicationArtifactLifecycle";

const NOW = new Date("2026-07-26T02:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";

function artifact(
  patch: Partial<ApplicationArtifactRecord> = {},
): ApplicationArtifactRecord {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: USER_ID,
    jobId: JOB_ID,
    applicationId: null,
    target: "RESUME_PDF",
    state: "STAGED",
    pathname: `applications/${USER_ID}/${JOB_ID}/resume.v1.pdf`,
    url: null,
    storeHost: null,
    storageIdentity: null,
    provisionalIdentity: null,
    contentVersion: "v1",
    contentHash: createHash("sha256").update("resume").digest("hex"),
    deleteAfter: null,
    retryCount: 0,
    nextAttemptAt: null,
    claimId: null,
    claimLeaseExpiresAt: null,
    lastError: null,
    stagedAt: new Date("2026-07-25T02:00:00.000Z"),
    referencedAt: null,
    deleteRequestedAt: null,
    deletedAt: null,
    inventorySeenAt: null,
    ...patch,
  };
}

function createDatabase() {
  const operations: string[] = [];
  const applicationArtifact = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const application = {
    findFirst: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
  };
  const tx = {
    $executeRaw: vi.fn(async () => {
      operations.push("lock");
      return 0;
    }),
    applicationArtifact,
    application,
    user,
  };
  const transaction = vi.fn(
    async (
      callback: (value: ApplicationArtifactTransaction) => Promise<unknown>,
    ) => callback(tx as unknown as ApplicationArtifactTransaction),
  );
  const database = {
    ...tx,
    $transaction: transaction,
  } as unknown as ApplicationArtifactDatabase;
  return {
    applicationArtifact,
    database,
    operations,
    transaction,
    user,
  };
}

describe("application artifact lifecycle", () => {
  it("canonicalizes physical storage identity across aliases but keeps stores distinct", () => {
    const base =
      "https://STORE.Example/applications/user/resume%20final.pdf";
    const first = canonicalizeApplicationArtifactStorageIdentity(
      `  ${base}?download=1#ignored  `,
    );
    const alias = canonicalizeApplicationArtifactStorageIdentity(base);
    const otherStore = canonicalizeApplicationArtifactStorageIdentity(
      base.replace("STORE.Example", "other.example"),
    );

    expect(first).toEqual({
      storeHost: "store.example",
      pathname: "applications/user/resume final.pdf",
      key: "store.example/applications/user/resume final.pdf",
    });
    expect(alias?.key).toBe(first?.key);
    expect(otherStore?.key).not.toBe(first?.key);
  });

  it("binds immutable paths to both content version and byte hash", () => {
    const firstHash = createHash("sha256").update("first").digest("hex");
    const secondHash = createHash("sha256").update("second").digest("hex");
    const base = {
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF" as const,
      contentVersion: "tailoring-run-7",
    };

    const first = buildImmutableApplicationArtifactPath({
      ...base,
      contentHash: firstHash,
    });
    const replay = buildImmutableApplicationArtifactPath({
      ...base,
      contentHash: firstHash,
    });
    const changed = buildImmutableApplicationArtifactPath({
      ...base,
      contentHash: secondHash,
    });

    expect(replay).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).toContain(firstHash);
    const samePrefixHash = `${firstHash.slice(0, 16)}${"f".repeat(48)}`;
    expect(
      buildImmutableApplicationArtifactPath({
        ...base,
        contentHash: samePrefixHash,
      }),
    ).not.toBe(first);
    expect(
      buildImmutableApplicationArtifactPath({
        ...base,
        target: "RESUME_TEX",
        contentHash: firstHash,
      }),
    ).toMatch(/\.tex$/);
  });

  it("only inventories strict UUID application paths", () => {
    const pathname = `applications/${USER_ID}/${JOB_ID}/cover.v1-abc.tex`;

    expect(parseApplicationArtifactPathname(pathname)).toEqual({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "COVER_TEX",
    });
    expect(
      parseApplicationArtifactPathname(
        "applications/user-1/job-1/cover.v1-abc.tex",
      ),
    ).toBeNull();
    expect(
      parseApplicationArtifactPathname(
        `other/${USER_ID}/${JOB_ID}/cover.v1-abc.tex`,
      ),
    ).toBeNull();
    expect(() =>
      buildImmutableApplicationArtifactPath({
        userId: "user-1",
        jobId: "job-1",
        target: "RESUME_PDF",
        contentVersion: "v1",
        contentHash: "a".repeat(64),
      }),
    ).toThrow(ApplicationArtifactConflictError);
  });

  it("takes JOBA and persists STAGED before returning an upload pathname", async () => {
    const { applicationArtifact, database, operations } = createDatabase();
    let created: ApplicationArtifactRecord | null = null;
    applicationArtifact.findUnique.mockImplementation(async () => {
      operations.push("find");
      return created;
    });
    applicationArtifact.createMany.mockImplementation(
      async (args: { data: Partial<ApplicationArtifactRecord>[] }) => {
        operations.push("createMany");
        created = artifact(args.data[0]);
        return { count: 1 };
      },
    );

    const result = await stageArtifact(
      {
        userId: USER_ID,
        jobId: JOB_ID,
        applicationId: APPLICATION_ID,
        target: "RESUME_PDF",
        contentVersion: "run-7",
        content: "new resume",
      },
      { database, now: () => NOW },
    );

    expect(result.disposition).toBe("STAGED");
    expect(result.artifact.state).toBe("STAGED");
    expect(result.artifact.url).toBeNull();
    expect(operations).toEqual(["lock", "find", "createMany", "find"]);
    expect(applicationArtifact.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        applicationId: APPLICATION_ID,
        pathname: result.pathname,
        contentHash: result.contentHash,
        stagedAt: NOW,
        state: "STAGED",
      })],
      skipDuplicates: true,
    });
  });

  it("adopts a metadata-null canonical REFERENCED row instead of creating a pathname-only duplicate", async () => {
    const content = "backfilled resume";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const pathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-backfill",
      contentHash,
    });
    const backfilled = artifact({
      pathname,
      state: "REFERENCED",
      applicationId: APPLICATION_ID,
      url: `https://store.public.blob.vercel-storage.com/${pathname}`,
      storeHost: "store.public.blob.vercel-storage.com",
      storageIdentity:
        `store.public.blob.vercel-storage.com/${pathname}`,
      provisionalIdentity: null,
      contentVersion: null,
      contentHash: null,
      referencedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    const duplicateStage = artifact({
      id: "55555555-5555-4555-8555-555555555555",
      pathname,
      provisionalIdentity: `pending:${pathname}`,
      contentVersion: "run-backfill",
      contentHash,
    });
    const database = createDatabase();
    database.applicationArtifact.findUnique.mockResolvedValue(null);
    database.applicationArtifact.findFirst.mockImplementation(
      async (args: {
        where: {
          state?: string | { in: string[] };
        };
      }) => {
        if (
          typeof args.where.state === "object" &&
          args.where.state.in.includes("DELETE_PENDING")
        ) {
          return null;
        }
        if (args.where.state === "REFERENCED") return backfilled;
        if (args.where.state === "STAGED") return duplicateStage;
        return null;
      },
    );
    database.applicationArtifact.update.mockResolvedValue({
      ...backfilled,
      contentVersion: "run-backfill",
      contentHash,
    });

    const result = await stageArtifact(
      {
        userId: USER_ID,
        jobId: JOB_ID,
        applicationId: APPLICATION_ID,
        target: "RESUME_PDF",
        contentVersion: "run-backfill",
        content,
      },
      { database: database.database, now: () => NOW },
    );

    expect(result).toMatchObject({
      disposition: "REPLAYED",
      pathname,
      artifact: {
        id: backfilled.id,
        state: "REFERENCED",
        contentVersion: "run-backfill",
        contentHash,
      },
    });
    expect(database.applicationArtifact.update).toHaveBeenCalledWith({
      where: { id: backfilled.id },
      data: {
        contentVersion: "run-backfill",
        contentHash,
      },
    });
    expect(database.applicationArtifact.createMany).not.toHaveBeenCalled();
  });

  it.each(["REFERENCED", "STAGED"] as const)(
    "does not upgrade an arbitrarily percent-encoded %s row into trusted writer provenance",
    async (legacyState) => {
    const content = "legacy encoded resume";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const basePathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-legacy",
      contentHash,
    });
    const legacy = artifact({
      pathname: basePathname,
      state: legacyState,
      applicationId: legacyState === "REFERENCED" ? APPLICATION_ID : null,
      url: `https://store.public.blob.vercel-storage.com/${basePathname.replace("applications", "%61pplications")}`,
      storeHost: "store.public.blob.vercel-storage.com",
      storageIdentity:
        `store.public.blob.vercel-storage.com/${basePathname}`,
      contentVersion: null,
      contentHash: null,
      referencedAt: legacyState === "REFERENCED" ? NOW : null,
    });
    const database = createDatabase();
    let created: ApplicationArtifactRecord | null = null;
    database.applicationArtifact.findFirst.mockImplementation(
      async (args: {
        where: {
          pathname?: string | { not: string };
          state?: string | { in: string[] };
        };
      }) =>
        args.where.state === legacyState &&
        typeof args.where.pathname === "string"
          ? legacy
          : null,
    );
    database.applicationArtifact.findUnique.mockImplementation(async () => created);
    database.applicationArtifact.createMany.mockImplementation(
      async (args: { data: Partial<ApplicationArtifactRecord>[] }) => {
        created = artifact(args.data[0]);
        return { count: 1 };
      },
    );
    const incarnation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const result = await stageArtifact(
      {
        userId: USER_ID,
        jobId: JOB_ID,
        target: "RESUME_PDF",
        contentVersion: "run-legacy",
        content,
      },
      {
        database: database.database,
        now: () => NOW,
        randomUuid: () => incarnation,
      },
    );

    expect(result.disposition).toBe("STAGED");
    expect(result.pathname).toContain(`${contentHash}-${incarnation}`);
    expect(database.applicationArtifact.update).not.toHaveBeenCalled();
    },
  );

  it("refreshes an identical STAGED replay but refuses a DELETING replay", async () => {
    const content = "same bytes";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const pathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-8",
      contentHash,
    });
    const staged = artifact({
      pathname,
      contentVersion: "run-8",
      contentHash,
    });
    const first = createDatabase();
    first.applicationArtifact.findUnique.mockResolvedValue(staged);
    first.applicationArtifact.update.mockResolvedValue({
      ...staged,
      stagedAt: NOW,
    });

    const replay = await stageArtifact(
      {
        userId: USER_ID,
        jobId: JOB_ID,
        target: "RESUME_PDF",
        contentVersion: "run-8",
        content,
      },
      { database: first.database, now: () => NOW },
    );

    expect(replay.disposition).toBe("REPLAYED");
    expect(first.applicationArtifact.update).toHaveBeenCalledWith({
      where: { id: staged.id },
      data: expect.objectContaining({ stagedAt: NOW }),
    });

    const second = createDatabase();
    second.applicationArtifact.findUnique.mockResolvedValue(
      artifact({
        ...staged,
        state: "DELETING",
        deleteAfter: NOW,
        deleteRequestedAt: NOW,
        claimId: "55555555-5555-4555-8555-555555555555",
        claimLeaseExpiresAt: new Date(NOW.getTime() + 60_000),
      }),
    );

    await expect(
      stageArtifact(
        {
          userId: USER_ID,
          jobId: JOB_ID,
          target: "RESUME_PDF",
          contentVersion: "run-8",
          content,
        },
        { database: second.database, now: () => NOW },
      ),
    ).rejects.toBeInstanceOf(ApplicationArtifactConflictError);
  });

  it.each(["DELETE_PENDING", "DELETING", "DELETED"] as const)(
    "never revives a %s pathname and allocates a UUID incarnation for the same bytes",
    async (retiredState) => {
    const content = "same bytes after retirement";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const retiredPathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-retired",
      contentHash,
    });
    const retired = artifact({
      pathname: retiredPathname,
      target:
        retiredState === "DELETED" ? "COVER_PDF" : "RESUME_PDF",
      contentVersion: "run-retired",
      contentHash,
      state: retiredState,
      deleteAfter: retiredState === "DELETED" ? null : NOW,
      deleteRequestedAt: NOW,
      deletedAt: retiredState === "DELETED" ? NOW : null,
      claimId:
        retiredState === "DELETING"
          ? "77777777-7777-4777-8777-777777777777"
          : null,
      claimLeaseExpiresAt:
        retiredState === "DELETING"
          ? new Date(NOW.getTime() + 60_000)
          : null,
    });
    const duplicateStage = artifact({
      id: "55555555-5555-4555-8555-555555555555",
      pathname: retiredPathname,
      provisionalIdentity: `pending:${retiredPathname}`,
      contentVersion: "run-retired",
      contentHash,
    });
    const incarnation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const database = createDatabase();
    let created: ApplicationArtifactRecord | null = null;
    database.applicationArtifact.findUnique.mockImplementation(
      async (args: { where: { provisionalIdentity?: string } }) =>
        args.where.provisionalIdentity && created
          ? created
          : null,
    );
    database.applicationArtifact.findFirst.mockImplementation(
      async (args: {
        where: {
          pathname?: string | { not: string };
          state?: string | { in: string[] };
        };
      }) => {
        if (
          typeof args.where.state === "object" &&
          args.where.state.in.includes("DELETE_PENDING")
        ) {
          return retired;
        }
        if (
          args.where.state === "STAGED" &&
          typeof args.where.pathname === "string"
        ) {
          return duplicateStage;
        }
        return null;
      },
    );
    database.applicationArtifact.createMany.mockImplementation(
      async (args: { data: Partial<ApplicationArtifactRecord>[] }) => {
        created = artifact(args.data[0]);
        return { count: 1 };
      },
    );

    const result = await stageArtifact(
      {
        userId: USER_ID,
        jobId: JOB_ID,
        target: "RESUME_PDF",
        contentVersion: "run-retired",
        content,
      },
      {
        database: database.database,
        now: () => NOW,
        randomUuid: () => incarnation,
      },
    );

    expect(result.disposition).toBe("STAGED");
    expect(result.pathname).not.toBe(retiredPathname);
    expect(result.pathname).toContain(`${contentHash}-${incarnation}`);
    expect(result.artifact.state).toBe("STAGED");
    expect(database.applicationArtifact.update).not.toHaveBeenCalled();
    },
  );

  it("reuses an active incarnation on exact retry even while the deterministic base is tombstoned", async () => {
    const content = "incarnated bytes";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const basePathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-incarnation",
      contentHash,
    });
    const incarnationPathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-incarnation",
      contentHash,
      incarnation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const retired = artifact({
      pathname: basePathname,
      contentVersion: "run-incarnation",
      contentHash,
      state: "DELETED",
      deleteRequestedAt: NOW,
      deletedAt: NOW,
    });
    const active = artifact({
      id: "66666666-6666-4666-8666-666666666666",
      pathname: incarnationPathname,
      provisionalIdentity: `pending:${incarnationPathname}`,
      contentVersion: "run-incarnation",
      contentHash,
      state: "STAGED",
    });
    const database = createDatabase();
    database.applicationArtifact.findFirst.mockImplementation(
      async (args: {
        where: {
          pathname?: string | { not: string };
          state?: string | { in: string[] };
        };
      }) => {
        if (
          typeof args.where.state === "object" &&
          args.where.state.in.includes("DELETE_PENDING")
        ) {
          return retired;
        }
        if (
          args.where.state === "STAGED" &&
          typeof args.where.pathname === "object"
        ) {
          return active;
        }
        return null;
      },
    );
    database.applicationArtifact.update.mockResolvedValue({
      ...active,
      stagedAt: NOW,
    });
    const randomUuid = vi.fn(() => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    const result = await stageArtifact(
      {
        userId: USER_ID,
        jobId: JOB_ID,
        target: "RESUME_PDF",
        contentVersion: "run-incarnation",
        content,
      },
      { database: database.database, now: () => NOW, randomUuid },
    );

    expect(result).toMatchObject({
      disposition: "REPLAYED",
      pathname: incarnationPathname,
      artifact: { id: active.id },
    });
    expect(randomUuid).not.toHaveBeenCalled();
    expect(database.applicationArtifact.createMany).not.toHaveBeenCalled();
  });

  it("resolves a concurrent stage with createMany without aborting its transaction", async () => {
    const content = "racing bytes";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const pathname = buildImmutableApplicationArtifactPath({
      userId: USER_ID,
      jobId: JOB_ID,
      target: "RESUME_PDF",
      contentVersion: "run-race",
      contentHash,
    });
    const raced = artifact({
      pathname,
      contentVersion: "run-race",
      contentHash,
      provisionalIdentity: `pending:${pathname}`,
    });
    const database = createDatabase();
    database.applicationArtifact.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    database.applicationArtifact.createMany.mockResolvedValue({ count: 0 });

    await expect(
      stageArtifact(
        {
          userId: USER_ID,
          jobId: JOB_ID,
          target: "RESUME_PDF",
          contentVersion: "run-race",
          content,
        },
        { database: database.database, now: () => NOW },
      ),
    ).resolves.toMatchObject({
      disposition: "REPLAYED",
      artifact: { id: raced.id },
    });
    expect(database.applicationArtifact.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("records an upload only on STAGED and replays the exact referenced URL", async () => {
    const staged = artifact();
    const uploadedUrl =
      `https://store.public.blob.vercel-storage.com/${staged.pathname}`;
    const storageIdentity =
      `store.public.blob.vercel-storage.com/${staged.pathname}`;
    const first = createDatabase();
    first.applicationArtifact.findUnique.mockResolvedValue(staged);
    first.applicationArtifact.update.mockResolvedValue({
      ...staged,
      url: uploadedUrl,
      storeHost: "store.public.blob.vercel-storage.com",
      storageIdentity,
      inventorySeenAt: NOW,
    });

    const recorded = await recordUploadedArtifact(
      {
        artifactId: staged.id,
        userId: USER_ID,
        pathname: staged.pathname,
        url: uploadedUrl,
      },
      { database: first.database, now: () => NOW },
    );

    expect(recorded.disposition).toBe("RECORDED");
    expect(first.applicationArtifact.update).toHaveBeenCalledWith({
      where: { id: staged.id },
      data: {
        url: uploadedUrl,
        storeHost: "store.public.blob.vercel-storage.com",
        storageIdentity,
        provisionalIdentity: null,
        inventorySeenAt: NOW,
      },
    });

    const referenced = artifact({
      state: "REFERENCED",
      applicationId: APPLICATION_ID,
      referencedAt: NOW,
      url: uploadedUrl,
      storeHost: "store.public.blob.vercel-storage.com",
      storageIdentity,
    });
    const second = createDatabase();
    second.applicationArtifact.findUnique.mockResolvedValue(referenced);
    await expect(
      recordUploadedArtifact(
        {
          artifactId: referenced.id,
          userId: USER_ID,
          pathname: referenced.pathname,
          url: referenced.url!,
        },
        { database: second.database },
      ),
    ).resolves.toMatchObject({ disposition: "REPLAYED" });

    const third = createDatabase();
    third.applicationArtifact.findUnique.mockResolvedValue(
      artifact({
        state: "DELETE_PENDING",
        url: null,
        deleteAfter: NOW,
        deleteRequestedAt: NOW,
      }),
    );
    await expect(
      recordUploadedArtifact(
        {
          artifactId: staged.id,
          userId: USER_ID,
          pathname: staged.pathname,
          url: uploadedUrl,
        },
        { database: third.database },
      ),
    ).rejects.toBeInstanceOf(ApplicationArtifactConflictError);
  });

  it("deduplicates URL aliases by physical identity without conflating stores", async () => {
    const canonicalPath = `applications/${USER_ID}/${JOB_ID}/resume.v1.pdf`;
    const canonicalUrl = `https://store.public.blob.vercel-storage.com/${canonicalPath}`;
    const aliasUrl = `  ${canonicalUrl}?download=1#ignored  `;
    const first = createDatabase();
    first.applicationArtifact.findUnique.mockResolvedValueOnce(null);

    await expect(
      enqueueApplicationArtifactRetirements(
        first.database as unknown as ApplicationArtifactTransaction,
        {
          userId: USER_ID,
          jobId: JOB_ID,
          applicationId: APPLICATION_ID,
          artifacts: [
            { target: "RESUME_PDF", url: canonicalUrl },
            { target: "COVER_PDF", url: aliasUrl },
          ],
          now: NOW,
        },
      ),
    ).resolves.toEqual({ queued: 1 });
    expect(first.applicationArtifact.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        pathname: canonicalPath,
        state: "DELETE_PENDING",
        url: canonicalUrl,
        storageIdentity:
          `store.public.blob.vercel-storage.com/${canonicalPath}`,
      })],
      skipDuplicates: true,
    });

    const existing = artifact({
      pathname: canonicalPath,
      url: canonicalUrl,
      storeHost: "store.public.blob.vercel-storage.com",
      storageIdentity:
        `store.public.blob.vercel-storage.com/${canonicalPath}`,
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const second = createDatabase();
    second.applicationArtifact.findUnique.mockResolvedValueOnce(existing);
    second.applicationArtifact.updateMany.mockResolvedValue({ count: 1 });

    await enqueueApplicationArtifactRetirements(
      second.database as unknown as ApplicationArtifactTransaction,
      {
        userId: USER_ID,
        jobId: JOB_ID,
        artifacts: [{ target: "RESUME_PDF", url: aliasUrl }],
        now: NOW,
      },
    );
    expect(second.applicationArtifact.createMany).not.toHaveBeenCalled();

    const third = createDatabase();
    third.applicationArtifact.findUnique.mockResolvedValueOnce(null);
    await enqueueApplicationArtifactRetirements(
      third.database as unknown as ApplicationArtifactTransaction,
      {
        userId: USER_ID,
        jobId: JOB_ID,
        artifacts: [{
          target: "RESUME_PDF",
          url: `https://another-store.example/${canonicalPath}`,
        }],
        now: NOW,
      },
    );
    expect(third.applicationArtifact.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        pathname: canonicalPath,
        storageIdentity: `another-store.example/${canonicalPath}`,
      })],
      skipDuplicates: true,
    });
  });

  it("deduplicates a shared legacy URL without rewriting ownership snapshots", async () => {
    const shared = artifact({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "REFERENCED",
      applicationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      referencedAt: NOW,
      url: "https://legacy.example/shared.pdf",
      storeHost: "legacy.example",
      storageIdentity: "legacy.example/shared.pdf",
    });
    const { applicationArtifact, database } = createDatabase();
    applicationArtifact.findUnique.mockResolvedValueOnce(shared);
    applicationArtifact.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      enqueueApplicationArtifactRetirements(
        database as unknown as ApplicationArtifactTransaction,
        {
          userId: USER_ID,
          jobId: JOB_ID,
          artifacts: [{ target: "RESUME_PDF", url: shared.url! }],
          now: NOW,
        },
      ),
    ).resolves.toEqual({ queued: 1 });

    expect(applicationArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: shared.id,
        state: { in: ["STAGED", "REFERENCED", "DELETE_PENDING"] },
      },
      data: expect.objectContaining({ state: "DELETE_PENDING" }),
    });
  });

  it("atomically references only active stages and rejects every retired pathname", async () => {
    const { applicationArtifact, database } = createDatabase();
    applicationArtifact.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      markArtifactsReferencedAndRetireSuperseded(
        database as unknown as ApplicationArtifactTransaction,
        {
          userId: USER_ID,
          jobId: JOB_ID,
          applicationId: APPLICATION_ID,
          referenced: [
            {
              target: "RESUME_PDF",
              pathname: "applications/a.pdf",
              url: "https://blob.example/applications/a.pdf",
            },
          ],
          now: NOW,
        },
      ),
    ).resolves.toEqual({ referenced: 1, retired: 0 });
    expect(applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: ["STAGED", "REFERENCED"] },
        }),
      }),
    );

    await expect(
      markArtifactsReferencedAndRetireSuperseded(
        database as unknown as ApplicationArtifactTransaction,
        {
          userId: USER_ID,
          jobId: JOB_ID,
          applicationId: APPLICATION_ID,
          referenced: [
            {
              target: "COVER_PDF",
              pathname: "applications/b.pdf",
              url: "https://blob.example/applications/b.pdf",
            },
          ],
          now: NOW,
        },
      ),
    ).rejects.toBeInstanceOf(ApplicationArtifactConflictError);
  });

  it("prepares every unclaimed tenant artifact for account erasure without stealing active claims", async () => {
    const { applicationArtifact, database } = createDatabase();
    applicationArtifact.count.mockResolvedValue(2);
    applicationArtifact.updateMany.mockResolvedValue({ count: 3 });
    applicationArtifact.deleteMany.mockResolvedValue({ count: 4 });

    await expect(
      prepareApplicationArtifactsForAccountErasure(
        database as unknown as ApplicationArtifactTransaction,
        {
          userId: USER_ID,
          now: NOW,
        },
      ),
    ).resolves.toEqual({
      queued: 3,
      deleting: 2,
      purgedDeleted: 4,
    });

    expect(applicationArtifact.count).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        state: "DELETING",
      },
    });
    expect(applicationArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        state: { in: ["STAGED", "REFERENCED", "DELETE_PENDING"] },
      },
      data: {
        state: "DELETE_PENDING",
        deleteAfter: NOW,
        deleteRequestedAt: NOW,
        retryCount: 0,
        nextAttemptAt: null,
        claimId: null,
        claimLeaseExpiresAt: null,
        lastError: null,
        deletedAt: null,
      },
    });
    expect(applicationArtifact.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        state: "DELETED",
      },
    });
  });

  it("rejects an invalid account-erasure owner before touching lifecycle rows", async () => {
    const { applicationArtifact, database } = createDatabase();

    await expect(
      prepareApplicationArtifactsForAccountErasure(
        database as unknown as ApplicationArtifactTransaction,
        { userId: "user-1", now: NOW },
      ),
    ).rejects.toBeInstanceOf(ApplicationArtifactConflictError);

    expect(applicationArtifact.count).not.toHaveBeenCalled();
    expect(applicationArtifact.updateMany).not.toHaveBeenCalled();
    expect(applicationArtifact.deleteMany).not.toHaveBeenCalled();
  });

  it("purges settled erasure metadata only after proving the User is absent", async () => {
    const existing = createDatabase();
    existing.user.findUnique.mockResolvedValue({ id: USER_ID });

    await expect(
      purgeDeletedApplicationArtifactsForErasedUser(
        existing.database as unknown as ApplicationArtifactTransaction,
        { userId: USER_ID },
      ),
    ).rejects.toBeInstanceOf(ApplicationArtifactConflictError);
    expect(existing.applicationArtifact.deleteMany).not.toHaveBeenCalled();

    const erased = createDatabase();
    erased.user.findUnique.mockResolvedValue(null);
    erased.applicationArtifact.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      purgeDeletedApplicationArtifactsForErasedUser(
        erased.database as unknown as ApplicationArtifactTransaction,
        { userId: USER_ID },
      ),
    ).resolves.toEqual({ purged: 2 });
    expect(erased.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { id: true },
    });
    expect(erased.applicationArtifact.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        state: "DELETED",
      },
    });
  });

  it("durably retires URL-known stages and leaves ambiguous uploads staged", async () => {
    const known = artifact({ url: "https://blob.example/known.pdf" });
    const ambiguous = artifact({
      id: "66666666-6666-4666-8666-666666666666",
      pathname: "applications/ambiguous.pdf",
    });
    const { applicationArtifact, database, operations } = createDatabase();
    applicationArtifact.findMany.mockImplementation(async () => {
      operations.push("findMany");
      return [known, ambiguous];
    });
    applicationArtifact.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      retireStagedArtifacts(
        {
          userId: USER_ID,
          jobId: JOB_ID,
          artifactIds: [known.id, ambiguous.id, known.id],
          now: NOW,
        },
        { database },
      ),
    ).resolves.toEqual({
      queued: 1,
      awaitingUploadResolution: 1,
    });

    expect(operations).toEqual(["lock", "findMany"]);
    expect(applicationArtifact.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [known.id, ambiguous.id] },
        userId: USER_ID,
        jobId: JOB_ID,
        state: "STAGED",
      },
    });
    expect(applicationArtifact.updateMany).toHaveBeenCalledTimes(1);
  });
});
