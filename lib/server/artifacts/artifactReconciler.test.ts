import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));
vi.mock("./vercelBlobAdapter", () => ({
  vercelArtifactBlobPort: {
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
}));

import {
  type ApplicationArtifactDatabase,
  type ApplicationArtifactRecord,
  type ApplicationArtifactTransaction,
} from "./applicationArtifactLifecycle";
import {
  ArtifactBlobPortUnavailableError,
  type ArtifactBlobObject,
  type ArtifactBlobPort,
} from "./artifactBlobPort";
import { reconcileApplicationArtifacts } from "./artifactReconciler";

const NOW = new Date("2026-07-26T02:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";
const ARTIFACT_ID = "44444444-4444-4444-8444-444444444444";
const PATHNAME = `applications/${USER_ID}/${JOB_ID}/resume.v1-abc.pdf`;
const URL = `https://store.public.blob.vercel-storage.com/${PATHNAME}`;

function artifact(
  patch: Partial<ApplicationArtifactRecord> = {},
): ApplicationArtifactRecord {
  return {
    id: ARTIFACT_ID,
    userId: USER_ID,
    jobId: JOB_ID,
    applicationId: null,
    target: "RESUME_PDF",
    state: "STAGED",
    pathname: PATHNAME,
    url: URL,
    storeHost: "store.public.blob.vercel-storage.com",
    storageIdentity: `store.public.blob.vercel-storage.com/${PATHNAME}`,
    provisionalIdentity: null,
    contentVersion: null,
    contentHash: null,
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

function blob(patch: Partial<ArtifactBlobObject> = {}): ArtifactBlobObject {
  return {
    pathname: PATHNAME,
    url: URL,
    size: 123,
    uploadedAt: new Date("2026-07-26T01:59:59.000Z"),
    etag: "etag-1",
    ...patch,
  };
}

function createDatabase() {
  const operations: string[] = [];
  const applicationArtifact = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const application = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const user = {
    findUnique: vi.fn().mockResolvedValue({ id: USER_ID }),
  };
  let checkpoint = {
    key: "vercel-applications-v1",
    cursor: null as string | null,
    claimId: null as string | null,
    claimLeaseExpiresAt: null as Date | null,
    scanStartedAt: null as Date | null,
    completedAt: null as Date | null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const applicationArtifactInventoryCheckpoint = {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findUnique: vi.fn(async () => ({ ...checkpoint })),
    updateMany: vi.fn(
      async (args: {
        where: { claimId?: string | null };
        data: Partial<typeof checkpoint>;
      }) => {
        if (
          args.where.claimId !== undefined &&
          args.where.claimId !== checkpoint.claimId
        ) {
          return { count: 0 };
        }
        checkpoint = { ...checkpoint, ...args.data };
        return { count: 1 };
      },
    ),
  };
  const tx = {
    $executeRaw: vi.fn(async (query: TemplateStringsArray | string) => {
      const sql = Array.isArray(query) ? query.join("?") : String(query);
      if (sql.includes("pg_advisory_xact_lock")) operations.push("lock");
      return 0;
    }),
    applicationArtifact,
    applicationArtifactInventoryCheckpoint,
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
    application,
    applicationArtifact,
    applicationArtifactInventoryCheckpoint,
    database,
    executeRaw: tx.$executeRaw,
    getCheckpoint: () => checkpoint,
    setCheckpoint: (value: Partial<typeof checkpoint>) => {
      checkpoint = { ...checkpoint, ...value };
    },
    operations,
    transaction,
    user,
  };
}

function trackArtifact(
  database: ReturnType<typeof createDatabase>,
  initial: ApplicationArtifactRecord,
) {
  let current = { ...initial };
  database.applicationArtifact.findMany.mockResolvedValue([current]);
  database.applicationArtifact.findUnique.mockImplementation(
    async (args: {
      where: { id?: string; storageIdentity?: string | null };
    }) => {
      if (args.where.id && args.where.id !== current.id) return null;
      if (
        args.where.storageIdentity &&
        args.where.storageIdentity !== current.storageIdentity
      ) {
        return null;
      }
      return { ...current };
    },
  );
  database.applicationArtifact.updateMany.mockImplementation(
    async (args: {
      where: {
        id?: string;
        state?: string | { in: string[] };
        claimId?: string | null;
      };
      data: Record<string, unknown>;
    }) => {
      if (args.where.id && args.where.id !== current.id) return { count: 0 };
      if (
        typeof args.where.state === "string" &&
        args.where.state !== current.state
      ) {
        return { count: 0 };
      }
      if (
        args.where.claimId !== undefined &&
        args.where.claimId !== current.claimId
      ) {
        return { count: 0 };
      }
      const data = { ...args.data };
      if (
        typeof data.retryCount === "object" &&
        data.retryCount &&
        "increment" in data.retryCount
      ) {
        data.retryCount =
          current.retryCount +
          Number((data.retryCount as { increment: number }).increment);
      }
      current = { ...current, ...data } as ApplicationArtifactRecord;
      return { count: 1 };
    },
  );
  database.applicationArtifact.update.mockImplementation(
    async (args: { data: Partial<ApplicationArtifactRecord> }) => {
      current = { ...current, ...args.data };
      return { ...current };
    },
  );
  return {
    get: () => current,
    set: (value: ApplicationArtifactRecord) => {
      current = { ...value };
    },
  };
}

function createBlobPort(): {
  blobPort: ArtifactBlobPort;
  deleteBlob: ReturnType<typeof vi.fn>;
  listBlobs: ReturnType<typeof vi.fn>;
  putBlob: ReturnType<typeof vi.fn>;
} {
  const putBlob = vi.fn();
  const deleteBlob = vi.fn().mockResolvedValue({ disposition: "deleted" });
  const listBlobs = vi.fn().mockResolvedValue({
    blobs: [],
    hasMore: false,
  });
  return {
    blobPort: {
      put: putBlob,
      delete: deleteBlob,
      list: listBlobs,
    } as ArtifactBlobPort,
    deleteBlob,
    listBlobs,
    putBlob,
  };
}

describe("application artifact reconciler", () => {
  it("keeps the default-off gate ahead of every database and Blob side effect", async () => {
    const database = createDatabase();
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: false,
      database: database.database,
      blobPort: port.blobPort,
    });

    expect(result).toMatchObject({
      kind: "disabled",
      reason: "ARTIFACT_RECONCILE_DISABLED",
      claimed: 0,
    });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.applicationArtifact.findMany).not.toHaveBeenCalled();
    expect(port.listBlobs).not.toHaveBeenCalled();
    expect(port.deleteBlob).not.toHaveBeenCalled();
  });

  it("bounds absent-user queueing before candidate selection and purges only settled ledger rows afterward", async () => {
    const database = createDatabase();
    const port = createBlobPort();

    await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(database.executeRaw).toHaveBeenCalledTimes(2);
    const queueCall = database.executeRaw.mock.calls[0]!;
    const purgeCall = database.executeRaw.mock.calls[1]!;
    const queueSql = Array.isArray(queueCall[0])
      ? queueCall[0].join("?")
      : String(queueCall[0]);
    const purgeSql = Array.isArray(purgeCall[0])
      ? purgeCall[0].join("?")
      : String(purgeCall[0]);

    expect(queueSql).toContain('WITH "orphaned"');
    expect(queueSql).toContain('FROM "User" AS owner');
    expect(queueSql).toContain(
      `artifact."state" IN ('REFERENCED', 'DELETE_PENDING')`,
    );
    expect(queueSql).toContain(`artifact."state" = 'STAGED'`);
    expect(queueSql).not.toContain("DELETING");
    expect(queueSql).toContain("LIMIT ?");
    expect(queueSql).toContain("FOR UPDATE OF artifact SKIP LOCKED");
    expect(queueSql).toContain(`"state" = 'DELETE_PENDING'`);
    expect(queueCall).toContain(50);

    expect(purgeSql).toContain('WITH "purgeable"');
    expect(purgeSql).toContain(`artifact."state" = 'DELETED'`);
    expect(purgeSql).toContain('DELETE FROM "ApplicationArtifact"');
    expect(purgeSql).toContain("LIMIT ?");
    expect(purgeSql).toContain("FOR UPDATE OF artifact SKIP LOCKED");
    expect(purgeCall).toContain(50);

    expect(database.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      database.applicationArtifact.findMany.mock.invocationCallOrder[0]!,
    );
    expect(
      database.applicationArtifact.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(database.executeRaw.mock.invocationCallOrder[1]!);
  });

  it("claims an expired pathname-only stage under JOBA and treats NotFound as an exclusive success bucket", async () => {
    const row = artifact({ url: null });
    const database = createDatabase();
    trackArtifact(database, row);
    const port = createBlobPort();
    port.deleteBlob.mockResolvedValue({ disposition: "not_found" });

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
      randomUuid: () => "55555555-5555-4555-8555-555555555555",
    });

    expect(result).toMatchObject({
      kind: "completed",
      claimed: 1,
      deleted: 0,
      notFound: 1,
      retried: 0,
      fenced: 0,
    });
    expect(database.operations).toEqual(["lock", "lock"]);
    expect(port.deleteBlob).toHaveBeenCalledWith(PATHNAME);
    expect(database.applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETING",
          claimId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
    );
    expect(database.applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: ARTIFACT_ID,
          state: "DELETING",
          claimId: "55555555-5555-4555-8555-555555555555",
        },
        data: expect.objectContaining({ state: "DELETED" }),
      }),
    );
  });

  it("samples a fresh clock for candidate, claim, authorization, and settle", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: new Date(NOW.getTime() - 60_000),
      deleteRequestedAt: new Date(NOW.getTime() - 60_000),
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const port = createBlobPort();
    const timestamps = [0, 1_000, 2_000, 3_000].map(
      (offset) => new Date(NOW.getTime() + offset),
    );
    let clockIndex = 0;

    await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => timestamps[clockIndex++] ?? timestamps.at(-1)!,
      claimLeaseMs: 10_000,
    });

    expect(database.applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          claimLeaseExpiresAt: new Date(NOW.getTime() + 11_000),
        }),
      }),
    );
    expect(database.applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: new Date(NOW.getTime() + 3_000),
        }),
      }),
    );
  });

  it("returns delete failures to DELETE_PENDING with bounded backoff", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: new Date(NOW.getTime() - 60_000),
      deleteRequestedAt: new Date(NOW.getTime() - 60_000),
      retryCount: 2,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const port = createBlobPort();
    port.deleteBlob.mockRejectedValue(new Error("temporary storage outage"));

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
      randomUuid: () => "55555555-5555-4555-8555-555555555555",
    });

    expect(result).toMatchObject({
      kind: "completed",
      claimed: 1,
      deleted: 0,
      notFound: 0,
      retried: 1,
    });
    expect(database.applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          state: "DELETE_PENDING",
          retryCount: { increment: 1 },
          nextAttemptAt: new Date(NOW.getTime() + 4 * 60_000),
          lastError: "temporary storage outage",
        }),
      }),
    );
  });

  it("protects any URL still referenced by an Application before external deletion", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    const tracked = trackArtifact(database, row);
    database.application.findFirst.mockResolvedValue({
      id: APPLICATION_ID,
      resumePdfUrl: URL,
      coverPdfUrl: null,
      resumeTexUrl: null,
      coverTexUrl: null,
    });
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      claimed: 0,
      protected: 1,
      deleted: 0,
      notFound: 0,
    });
    expect(port.deleteBlob).not.toHaveBeenCalled();
    expect(tracked.get()).toMatchObject({
      state: "DELETE_PENDING",
      applicationId: null,
    });
    expect(database.applicationArtifact.updateMany).not.toHaveBeenCalled();
  });

  it("protects a base/download alias through canonical host and pathname lookup", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    database.application.findMany.mockResolvedValue([
      {
        id: APPLICATION_ID,
        resumePdfUrl: `  ${URL}?download=1#ignored  `,
        coverPdfUrl: null,
        resumeTexUrl: null,
        coverTexUrl: null,
      },
    ]);
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 0, protected: 1 });
    expect(port.deleteBlob).not.toHaveBeenCalled();
    expect(database.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                {
                  resumePdfUrl: {
                    contains: "store.public.blob.vercel-storage.com",
                    mode: "insensitive",
                  },
                },
                {
                  resumePdfUrl: {
                    contains: PATHNAME,
                    mode: "insensitive",
                  },
                },
              ]),
            }),
          ]),
        },
      }),
    );
  });

  it("falls back to a canonical host scan when the only live pointer encodes a path separator", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const encodedUrl = URL.replace(
      `/${USER_ID}/${JOB_ID}/`,
      `/${USER_ID}%2F${JOB_ID}/`,
    );
    const database = createDatabase();
    trackArtifact(database, row);
    const encodedApplication = {
      id: APPLICATION_ID,
      resumePdfUrl: encodedUrl,
      coverPdfUrl: null,
      resumeTexUrl: null,
      coverTexUrl: null,
    };
    database.application.findMany.mockImplementation(
      async (args: {
        where: {
          OR: Array<{ AND?: unknown }>;
        };
      }) =>
        // A pathname-prefiltered query cannot match a slash encoded as %2F.
        args.where.OR.some((filter) => "AND" in filter)
          ? []
          : [encodedApplication],
    );
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 0, protected: 1 });
    expect(port.deleteBlob).not.toHaveBeenCalled();
    expect(database.application.findMany).toHaveBeenCalledTimes(2);
    expect(database.application.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: { id: "asc" },
        take: 201,
        where: {
          OR: expect.arrayContaining([
            {
              resumePdfUrl: {
                contains: "store.public.blob.vercel-storage.com",
                mode: "insensitive",
              },
            },
          ]),
        },
      }),
    );
  });

  it("protects a metadata-null artifact through the bounded fallback when a live pointer percent-encodes an ASCII byte", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
      contentHash: null,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const encodedApplication = {
      id: APPLICATION_ID,
      resumePdfUrl: URL.replace("applications", "%61pplications"),
      coverPdfUrl: null,
      resumeTexUrl: null,
      coverTexUrl: null,
    };
    database.application.findMany.mockImplementation(
      async (args: { where: { OR: Array<{ AND?: unknown }> } }) =>
        args.where.OR.some((filter) => "AND" in filter)
          ? []
          : [encodedApplication],
    );
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 0, protected: 1, deleted: 0 });
    expect(database.application.findMany).toHaveBeenCalledTimes(2);
    expect(port.deleteBlob).not.toHaveBeenCalled();
  });

  it("protects a URL-known artifact when a live pointer adds an encoded leading slash", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const encodedApplication = {
      id: APPLICATION_ID,
      resumePdfUrl: URL.replace(`/${PATHNAME}`, `/%2F${PATHNAME}`),
      coverPdfUrl: null,
      resumeTexUrl: null,
      coverTexUrl: null,
    };
    database.application.findMany.mockResolvedValue([encodedApplication]);
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 0, protected: 1, deleted: 0 });
    expect(database.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                {
                  resumePdfUrl: {
                    contains: `%2F${PATHNAME}`,
                    mode: "insensitive",
                  },
                },
              ]),
            }),
          ]),
        },
      }),
    );
    expect(port.deleteBlob).not.toHaveBeenCalled();
  });

  it("does not enter the broad fallback for a trusted hashed strict-path orphan", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
      contentHash: "a".repeat(64),
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const overBudget = Array.from({ length: 201 }, (_, index) => ({
      id: `candidate-${index}`,
      resumePdfUrl: `https://store.public.blob.vercel-storage.com/unrelated/${index}.pdf`,
      coverPdfUrl: null,
      resumeTexUrl: null,
      coverTexUrl: null,
    }));
    database.application.findMany.mockImplementation(
      async (args: { where: { OR: Array<{ AND?: unknown }> } }) =>
        args.where.OR.some((filter) => "AND" in filter) ? [] : overBudget,
    );
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, protected: 0, deleted: 1 });
    expect(database.application.findMany).toHaveBeenCalledTimes(2);
    expect(
      database.application.findMany.mock.calls.every(([args]) =>
        args.where.OR.every((filter: { AND?: unknown }) => "AND" in filter),
      ),
    ).toBe(true);
    expect(port.deleteBlob).toHaveBeenCalledWith(URL);
  });

  it("protects a pathname-only deletion when any current Application URL has that pathname", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      url: null,
      storeHost: null,
      storageIdentity: null,
      provisionalIdentity: `pending:${PATHNAME}`,
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    database.application.findMany.mockResolvedValue([
      {
        id: APPLICATION_ID,
        resumePdfUrl: `https://another-store.example/${PATHNAME}?download=1`,
        coverPdfUrl: null,
        resumeTexUrl: null,
        coverTexUrl: null,
      },
    ]);
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 0, protected: 1, deleted: 0 });
    expect(port.deleteBlob).not.toHaveBeenCalled();
  });

  it("fails closed without deleting when the reference fallback exceeds its bounded budget", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      pathname: "legacy/orphan.pdf",
      url: "https://store.public.blob.vercel-storage.com/legacy/orphan.pdf",
      storageIdentity:
        "store.public.blob.vercel-storage.com/legacy/orphan.pdf",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const overBudget = Array.from({ length: 201 }, (_, index) => ({
      id: `candidate-${String(index).padStart(3, "0")}`,
      resumePdfUrl: `https://store.public.blob.vercel-storage.com/unrelated/${index}.pdf`,
      coverPdfUrl: null,
      resumeTexUrl: null,
      coverTexUrl: null,
    }));
    database.application.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(overBudget)
      .mockResolvedValue([]);
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 0, protected: 1, deleted: 0 });
    expect(port.deleteBlob).not.toHaveBeenCalled();
    expect(database.application.findMany).toHaveBeenCalledTimes(2);
    expect(database.application.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderBy: { id: "asc" }, take: 201 }),
    );
  });

  it("does not protect the same pathname in a different storage hostname", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    database.application.findMany.mockResolvedValue([
      {
        id: APPLICATION_ID,
        resumePdfUrl: `https://other-store.example/${PATHNAME}`,
        coverPdfUrl: null,
        resumeTexUrl: null,
        coverTexUrl: null,
      },
    ]);
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, protected: 0, deleted: 1 });
    expect(port.deleteBlob).toHaveBeenCalledWith(URL);
  });

  it("revalidates a claim and cancels deletion when it becomes current before Blob I/O", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    const tracked = trackArtifact(database, row);
    database.application.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: APPLICATION_ID,
        resumePdfUrl: `${URL}?download=1`,
        coverPdfUrl: null,
        resumeTexUrl: null,
        coverTexUrl: null,
      });
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      claimed: 1,
      protected: 1,
      deleted: 0,
      fenced: 0,
    });
    expect(port.deleteBlob).not.toHaveBeenCalled();
    expect(tracked.get()).toMatchObject({
      state: "DELETE_PENDING",
      applicationId: null,
      claimId: null,
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
      lastError: "Application artifact pathname is still referenced",
    });
  });

  it("fences a stale worker that lost its claim before settle", async () => {
    const row = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const updateState =
      database.applicationArtifact.updateMany.getMockImplementation()!;
    database.applicationArtifact.updateMany.mockImplementation(
      async (args: { data: { state?: string } }) =>
        args.data.state === "DELETED" ? { count: 0 } : updateState(args),
    );
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      claimed: 1,
      deleted: 0,
      fenced: 1,
    });
  });

  it("takes over an expired DELETING lease with compare-and-swap fencing", async () => {
    const oldClaim = "77777777-7777-4777-8777-777777777777";
    const lease = new Date(NOW.getTime() - 1);
    const row = artifact({
      state: "DELETING",
      deleteAfter: new Date(NOW.getTime() - 60_000),
      deleteRequestedAt: new Date(NOW.getTime() - 60_000),
      claimId: oldClaim,
      claimLeaseExpiresAt: lease,
    });
    const database = createDatabase();
    trackArtifact(database, row);
    const port = createBlobPort();

    await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
      randomUuid: () => "88888888-8888-4888-8888-888888888888",
    });

    expect(database.applicationArtifact.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: ARTIFACT_ID,
          state: "DELETING",
          claimId: oldClaim,
          claimLeaseExpiresAt: lease,
        }),
        data: expect.objectContaining({
          claimId: "88888888-8888-4888-8888-888888888888",
        }),
      }),
    );
  });

  it("pages the full inventory and durably quarantines even a recent first sighting", async () => {
    const secondPath = `applications/${USER_ID}/${JOB_ID}/cover.v2-def.tex`;
    const database = createDatabase();
    const createRows: ApplicationArtifactRecord[] = [];
    const byStorageIdentity = new Map<string, ApplicationArtifactRecord>();
    database.applicationArtifact.findUnique.mockImplementation(
      async (args: { where: { storageIdentity?: string } }) =>
        args.where.storageIdentity
          ? (byStorageIdentity.get(args.where.storageIdentity) ?? null)
          : null,
    );
    database.applicationArtifact.createMany.mockImplementation(
      async (args: { data: Partial<ApplicationArtifactRecord>[] }) => {
        const created = artifact({
          id: `artifact-${createRows.length + 1}`,
          ...args.data[0],
        });
        createRows.push(created);
        byStorageIdentity.set(created.storageIdentity!, created);
        return { count: 1 };
      },
    );
    const port = createBlobPort();
    port.listBlobs
      .mockResolvedValueOnce({
        blobs: [
          blob(),
          blob({
            pathname: "applications/not-a-uuid/job/resume.v1.pdf",
            url: "https://blob.example/invalid.pdf",
          }),
        ],
        cursor: "cursor-2",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        blobs: [
          blob({
            pathname: secondPath,
            url: `https://store.public.blob.vercel-storage.com/${secondPath}`,
            uploadedAt: new Date("2026-07-20T00:00:00.000Z"),
          }),
        ],
        hasMore: false,
      });

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "completed",
      inventory: {
        status: "completed",
        pages: 2,
        seen: 3,
        discovered: 2,
        ignored: 1,
      },
    });
    expect(port.listBlobs).toHaveBeenNthCalledWith(1, {
      prefix: "applications/",
      limit: 50,
    });
    expect(port.listBlobs).toHaveBeenNthCalledWith(2, {
      prefix: "applications/",
      cursor: "cursor-2",
      limit: 50,
    });
    expect(createRows).toHaveLength(2);
    expect(createRows[0]).toMatchObject({
      state: "STAGED",
      stagedAt: NOW,
      pathname: PATHNAME,
    });
    expect(database.operations).toEqual(["lock", "lock"]);
  });

  it("checkpoints a bounded inventory page and resumes without exposing the opaque cursor", async () => {
    const database = createDatabase();
    const port = createBlobPort();
    port.listBlobs
      .mockResolvedValueOnce({
        blobs: [],
        cursor: "opaque-next-page",
        hasMore: true,
      })
      .mockResolvedValueOnce({ blobs: [], hasMore: false });

    const partial = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      inventoryPageLimit: 1,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(partial).toMatchObject({
      inventory: { status: "partial", pages: 1 },
    });
    expect(partial.inventory).not.toHaveProperty("cursor");
    expect(database.getCheckpoint()).toMatchObject({
      cursor: "opaque-next-page",
      claimId: null,
      claimLeaseExpiresAt: null,
    });

    const completed = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      inventoryPageLimit: 1,
      database: database.database,
      blobPort: port.blobPort,
      now: () => new Date(NOW.getTime() + 1_000),
    });

    expect(port.listBlobs).toHaveBeenNthCalledWith(2, {
      prefix: "applications/",
      cursor: "opaque-next-page",
      limit: 50,
    });
    expect(completed).toMatchObject({
      inventory: { status: "completed", pages: 1 },
    });
    expect(database.getCheckpoint()).toMatchObject({
      cursor: null,
      claimId: null,
      scanStartedAt: null,
    });
  });

  it("reports a live inventory lease as busy without touching Blob listing", async () => {
    const database = createDatabase();
    database.setCheckpoint({
      claimId: "99999999-9999-4999-8999-999999999999",
      claimLeaseExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    const port = createBlobPort();

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      inventory: { status: "busy", pages: 0, seen: 0 },
    });
    expect(port.listBlobs).not.toHaveBeenCalled();
  });

  it("takes over an expired inventory lease and resumes its durable cursor", async () => {
    const database = createDatabase();
    database.setCheckpoint({
      cursor: "cursor-after-crash",
      claimId: "99999999-9999-4999-8999-999999999999",
      claimLeaseExpiresAt: new Date(NOW.getTime() - 1),
      scanStartedAt: new Date(NOW.getTime() - 60_000),
    });
    const port = createBlobPort();
    port.listBlobs.mockResolvedValue({ blobs: [], hasMore: false });

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
      randomUuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(port.listBlobs).toHaveBeenCalledWith({
      prefix: "applications/",
      cursor: "cursor-after-crash",
      limit: 50,
    });
    expect(result).toMatchObject({
      inventory: { status: "completed", pages: 1 },
    });
    expect(database.getCheckpoint()).toMatchObject({
      cursor: null,
      claimId: null,
      claimLeaseExpiresAt: null,
    });
  });

  it("locks inventory against claim and records an unknown current Blob as REFERENCED", async () => {
    const database = createDatabase();
    let created: ApplicationArtifactRecord | null = null;
    database.applicationArtifact.findUnique.mockImplementation(
      async () => created,
    );
    database.applicationArtifact.createMany.mockImplementation(
      async (args: { data: Partial<ApplicationArtifactRecord>[] }) => {
        created = artifact(args.data[0]);
        return { count: 1 };
      },
    );
    database.application.findFirst.mockImplementation(async () => {
      database.operations.push("current");
      return {
        id: APPLICATION_ID,
        resumePdfUrl: URL,
        coverPdfUrl: null,
        resumeTexUrl: null,
        coverTexUrl: null,
      };
    });
    const port = createBlobPort();
    port.listBlobs.mockResolvedValue({
      blobs: [blob()],
      hasMore: false,
    });

    await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(database.operations.slice(0, 2)).toEqual(["lock", "current"]);
    expect(database.applicationArtifact.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          state: "REFERENCED",
          applicationId: APPLICATION_ID,
          referencedAt: NOW,
          stagedAt: NOW,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("quarantines an inventory Blob for an erased owner instead of reviving private lifecycle state", async () => {
    const database = createDatabase();
    database.user.findUnique.mockResolvedValue(null);
    let created: ApplicationArtifactRecord | null = null;
    database.applicationArtifact.findUnique.mockImplementation(
      async (args: {
        where: {
          storageIdentity?: string;
          provisionalIdentity?: string;
        };
      }) => {
        if (args.where.provisionalIdentity) return null;
        if (args.where.storageIdentity) return created;
        return null;
      },
    );
    database.applicationArtifact.createMany.mockImplementation(
      async (args: { data: Partial<ApplicationArtifactRecord>[] }) => {
        created = artifact(args.data[0]);
        return { count: 1 };
      },
    );
    const port = createBlobPort();
    port.listBlobs.mockResolvedValue({ blobs: [blob()], hasMore: false });

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      inventory: {
        status: "completed",
        seen: 1,
        discovered: 1,
        ignored: 0,
      },
    });
    expect(created).toMatchObject({
      userId: USER_ID,
      state: "DELETE_PENDING",
      applicationId: null,
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
      url: URL,
    });
    expect(database.application.findFirst).not.toHaveBeenCalled();
    expect(database.application.findMany).not.toHaveBeenCalled();
  });

  it("adopts a pathname-only stage when inventory recovers a lost upload response", async () => {
    const provisional = artifact({
      url: null,
      storeHost: null,
      storageIdentity: null,
      provisionalIdentity: `pending:${PATHNAME}`,
      stagedAt: NOW,
    });
    const database = createDatabase();
    database.applicationArtifact.findUnique.mockImplementation(
      async (args: {
        where: {
          storageIdentity?: string;
          provisionalIdentity?: string;
        };
      }) => {
        if (args.where.storageIdentity) return null;
        if (args.where.provisionalIdentity === `pending:${PATHNAME}`) {
          return provisional;
        }
        return null;
      },
    );
    database.applicationArtifact.updateMany.mockResolvedValue({ count: 1 });
    const port = createBlobPort();
    port.listBlobs.mockResolvedValue({ blobs: [blob()], hasMore: false });

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      inventory: { status: "completed", discovered: 0, ignored: 0 },
    });
    expect(database.applicationArtifact.createMany).not.toHaveBeenCalled();
    expect(database.applicationArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: provisional.id,
        state: "STAGED",
        provisionalIdentity: `pending:${PATHNAME}`,
      },
      data: expect.objectContaining({
        url: URL,
        storeHost: "store.public.blob.vercel-storage.com",
        storageIdentity: `store.public.blob.vercel-storage.com/${PATHNAME}`,
        provisionalIdentity: null,
        inventorySeenAt: NOW,
      }),
    });
  });

  it("treats a matching DELETING provisional row as known during an overlapping inventory scan", async () => {
    const deleting = artifact({
      state: "DELETE_PENDING",
      url: null,
      storeHost: null,
      storageIdentity: null,
      provisionalIdentity: `pending:${PATHNAME}`,
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    const tracked = trackArtifact(database, deleting);
    const port = createBlobPort();
    let signalDeleteStarted!: () => void;
    let releaseDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    const deleteReleased = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    port.deleteBlob.mockImplementation(async () => {
      signalDeleteStarted();
      await deleteReleased;
      return { disposition: "deleted" };
    });
    port.listBlobs.mockResolvedValue({ blobs: [blob()], hasMore: false });

    const drain = reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
      randomUuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    await deleteStarted;
    expect(tracked.get()).toMatchObject({
      state: "DELETING",
      provisionalIdentity: `pending:${PATHNAME}`,
    });

    const inventory = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
      randomUuid: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    expect(inventory).toMatchObject({
      inventory: {
        status: "completed",
        seen: 1,
        discovered: 0,
        ignored: 0,
      },
    });
    expect(database.applicationArtifact.createMany).not.toHaveBeenCalled();
    expect(tracked.get()).toMatchObject({
      state: "DELETING",
      storageIdentity: null,
      provisionalIdentity: `pending:${PATHNAME}`,
    });

    releaseDelete();
    await expect(drain).resolves.toMatchObject({ deleted: 1 });
    expect(tracked.get()).toMatchObject({ state: "DELETED" });
  });

  it("requeues a reappearing DELETED identity without reviving its pathname", async () => {
    const deleted = artifact({
      pathname: "legacy/deleted",
      state: "DELETED",
      applicationId: APPLICATION_ID,
      deletedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    const database = createDatabase();
    database.applicationArtifact.findUnique.mockResolvedValue(deleted);
    database.applicationArtifact.update.mockResolvedValue({
      ...deleted,
      state: "DELETE_PENDING",
    });
    const port = createBlobPort();
    port.listBlobs.mockResolvedValue({ blobs: [blob()], hasMore: false });

    await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(database.applicationArtifact.update).toHaveBeenCalledWith({
      where: { id: deleted.id },
      data: expect.objectContaining({
        state: "DELETE_PENDING",
        applicationId: null,
        deleteAfter: NOW,
        deleteRequestedAt: NOW,
        deletedAt: null,
        inventorySeenAt: NOW,
      }),
    });
  });

  it("quarantines REFERENCED drift once, then lets staged grace make it eligible", async () => {
    const referenced = artifact({
      state: "REFERENCED",
      applicationId: APPLICATION_ID,
      referencedAt: new Date("2026-07-20T00:00:00.000Z"),
    });
    const inventoryDatabase = createDatabase();
    inventoryDatabase.applicationArtifact.findUnique.mockResolvedValue(
      referenced,
    );
    const inventoryPort = createBlobPort();
    inventoryPort.listBlobs.mockResolvedValue({
      blobs: [blob()],
      hasMore: false,
    });

    await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: inventoryDatabase.database,
      blobPort: inventoryPort.blobPort,
      now: () => NOW,
    });

    expect(
      inventoryDatabase.applicationArtifact.updateMany,
    ).toHaveBeenCalledWith({
      where: { id: referenced.id, state: "REFERENCED" },
      data: expect.objectContaining({
        state: "STAGED",
        applicationId: null,
        stagedAt: NOW,
        referencedAt: null,
      }),
    });

    const quarantined = artifact({
      state: "STAGED",
      applicationId: null,
      referencedAt: null,
      stagedAt: NOW,
    });
    const drainDatabase = createDatabase();
    trackArtifact(drainDatabase, quarantined);
    const drainPort = createBlobPort();

    const drained = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: drainDatabase.database,
      blobPort: drainPort.blobPort,
      now: () => new Date(NOW.getTime() + 7 * 60 * 60 * 1000),
    });

    expect(drained).toMatchObject({ claimed: 1, deleted: 1 });
    expect(drainPort.deleteBlob).toHaveBeenCalledWith(URL);
  });

  it("continues the durable drain when inventory listing fails", async () => {
    const pending = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, pending);
    const port = createBlobPort();
    const externalOrder: string[] = [];
    port.deleteBlob.mockImplementation(async () => {
      externalOrder.push("delete");
      return { disposition: "deleted" };
    });
    port.listBlobs.mockImplementation(async () => {
      externalOrder.push("list");
      throw new Error("inventory unavailable");
    });

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: true,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "completed",
      claimed: 1,
      deleted: 1,
      inventory: {
        status: "failed",
        error: "inventory unavailable",
      },
    });
    expect(port.deleteBlob).toHaveBeenCalledWith(URL);
    expect(externalOrder).toEqual(["delete", "list"]);
  });

  it("reports an unavailable port while durably rescheduling the claim", async () => {
    const pending = artifact({
      state: "DELETE_PENDING",
      deleteAfter: NOW,
      deleteRequestedAt: NOW,
    });
    const database = createDatabase();
    trackArtifact(database, pending);
    const port = createBlobPort();
    port.deleteBlob.mockRejectedValue(
      new ArtifactBlobPortUnavailableError("missing Blob token"),
    );

    const result = await reconcileApplicationArtifacts({
      enabled: true,
      inventory: false,
      database: database.database,
      blobPort: port.blobPort,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      kind: "port_unavailable",
      reason: "ARTIFACT_BLOB_PORT_UNAVAILABLE",
      message: "missing Blob token",
      claimed: 1,
      retried: 1,
    });
  });
});
