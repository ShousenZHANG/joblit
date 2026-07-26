import { randomUUID } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import {
  canonicalizeApplicationArtifactStorageIdentity,
  defaultApplicationArtifactDatabase,
  parseApplicationArtifactPathname,
  type ApplicationArtifactDatabase,
  type ApplicationArtifactRecord,
  type ApplicationArtifactTransaction,
} from "./applicationArtifactLifecycle";
import {
  isArtifactBlobPortUnavailable,
  type ArtifactBlobObject,
  type ArtifactBlobPort,
} from "./artifactBlobPort";
import { vercelArtifactBlobPort } from "./vercelBlobAdapter";

const APPLICATION_ARTIFACT_PREFIX = "applications/";
const DEFAULT_LIMIT = 50;
const DEFAULT_STAGED_GRACE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_INVENTORY_PAGE_SIZE = 50;
const DEFAULT_INVENTORY_PAGE_LIMIT = 2;
const DEFAULT_INVENTORY_OBJECT_LIMIT = 500;
const INVENTORY_CHECKPOINT_KEY = "vercel-applications-v1";
const REFERENCE_FALLBACK_MAX_CANDIDATES = 200;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * Legacy/manual User deletion can bypass the explicit account-erasure hook.
 * Sweep a bounded batch without touching active DELETING claims. STAGED rows
 * retain the normal upload-response grace window before becoming eligible.
 */
async function queueArtifactsForAbsentUsers(input: {
  database: ApplicationArtifactDatabase;
  now: Date;
  stagedCutoff: Date;
  limit: number;
}): Promise<number> {
  return input.database.$executeRaw`
    WITH "orphaned" AS (
      SELECT artifact."id"
      FROM "ApplicationArtifact" AS artifact
      WHERE NOT EXISTS (
        SELECT 1
        FROM "User" AS owner
        WHERE owner."id" = artifact."userId"
      )
        AND (
          artifact."state" IN ('REFERENCED', 'DELETE_PENDING')
          OR (
            artifact."state" = 'STAGED'
            AND artifact."stagedAt" <= ${input.stagedCutoff}
          )
        )
      ORDER BY artifact."updatedAt" ASC, artifact."id" ASC
      LIMIT ${input.limit}
      FOR UPDATE OF artifact SKIP LOCKED
    )
    UPDATE "ApplicationArtifact" AS artifact
    SET
      "state" = 'DELETE_PENDING',
      "applicationId" = NULL,
      "deleteAfter" = LEAST(
        COALESCE(artifact."deleteAfter", ${input.now}),
        ${input.now}
      ),
      "deleteRequestedAt" = COALESCE(
        artifact."deleteRequestedAt",
        ${input.now}
      ),
      "retryCount" = CASE
        WHEN artifact."state" = 'DELETE_PENDING' THEN artifact."retryCount"
        ELSE 0
      END,
      "nextAttemptAt" = CASE
        WHEN artifact."state" = 'DELETE_PENDING' THEN artifact."nextAttemptAt"
        ELSE NULL
      END,
      "claimId" = NULL,
      "claimLeaseExpiresAt" = NULL,
      "lastError" = CASE
        WHEN artifact."state" = 'DELETE_PENDING' THEN artifact."lastError"
        ELSE NULL
      END,
      "deletedAt" = NULL,
      "updatedAt" = ${input.now}
    FROM "orphaned"
    WHERE artifact."id" = "orphaned"."id"
  `;
}

/**
 * Once external bytes are settled, lifecycle metadata for an erased account
 * has no retention purpose. Purge only a bounded batch of DELETED rows after
 * proving their scalar owner snapshot no longer resolves to a User.
 */
async function purgeDeletedArtifactsForAbsentUsers(input: {
  database: ApplicationArtifactDatabase;
  limit: number;
}): Promise<number> {
  return input.database.$executeRaw`
    WITH "purgeable" AS (
      SELECT artifact."id"
      FROM "ApplicationArtifact" AS artifact
      WHERE artifact."state" = 'DELETED'
        AND NOT EXISTS (
          SELECT 1
          FROM "User" AS owner
          WHERE owner."id" = artifact."userId"
        )
      ORDER BY artifact."deletedAt" ASC, artifact."id" ASC
      LIMIT ${input.limit}
      FOR UPDATE OF artifact SKIP LOCKED
    )
    DELETE FROM "ApplicationArtifact" AS artifact
    USING "purgeable"
    WHERE artifact."id" = "purgeable"."id"
  `;
}

type InventorySummary =
  | {
      status: "disabled";
      pages: 0;
      seen: 0;
      discovered: 0;
      ignored: 0;
    }
  | {
      status: "completed";
      pages: number;
      seen: number;
      discovered: number;
      ignored: number;
    }
  | {
      status: "partial";
      pages: number;
      seen: number;
      discovered: number;
      ignored: number;
    }
  | {
      status: "busy";
      pages: 0;
      seen: 0;
      discovered: 0;
      ignored: 0;
    }
  | {
      status: "failed";
      pages: number;
      seen: number;
      discovered: number;
      ignored: number;
      error: string;
      portUnavailable: boolean;
    };

type ReconcileCounters = {
  claimed: number;
  deleted: number;
  notFound: number;
  protected: number;
  retried: number;
  fenced: number;
};

export type ApplicationArtifactReconcileResult =
  | ({
      kind: "disabled";
      reason: "ARTIFACT_RECONCILE_DISABLED";
      inventory: Extract<InventorySummary, { status: "disabled" }>;
    } & ReconcileCounters)
  | ({
      kind: "completed";
      inventory: InventorySummary;
    } & ReconcileCounters)
  | ({
      kind: "port_unavailable";
      reason: "ARTIFACT_BLOB_PORT_UNAVAILABLE";
      message: string;
      inventory: InventorySummary;
    } & ReconcileCounters);

export type ReconcileApplicationArtifactsOptions = {
  /**
   * Explicit override for tests and bounded operators. Production defaults to
   * disabled unless ARTIFACT_RECONCILE_ENABLED is exactly "true" or "1".
   */
  enabled?: boolean;
  inventory?: boolean;
  artifactIds?: readonly string[];
  limit?: number;
  stagedGraceMs?: number;
  inventoryPageSize?: number;
  inventoryPageLimit?: number;
  inventoryObjectLimit?: number;
  inventoryClaimLeaseMs?: number;
  claimLeaseMs?: number;
  database?: ApplicationArtifactDatabase;
  blobPort?: ArtifactBlobPort;
  now?: () => Date;
  randomUuid?: () => string;
};

type ClaimResult =
  | { kind: "claimed"; artifact: ApplicationArtifactRecord; claimId: string }
  | { kind: "protected" }
  | { kind: "skipped" };

function emptyCounters(): ReconcileCounters {
  return {
    claimed: 0,
    deleted: 0,
    notFound: 0,
    protected: 0,
    retried: 0,
    fenced: 0,
  };
}

function disabledInventory(): Extract<
  InventorySummary,
  { status: "disabled" }
> {
  return {
    status: "disabled",
    pages: 0,
    seen: 0,
    discovered: 0,
    ignored: 0,
  };
}

function reconcileEnabled(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  return (
    process.env.ARTIFACT_RECONCILE_ENABLED === "true" ||
    process.env.ARTIFACT_RECONCILE_ENABLED === "1"
  );
}

function boundedError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Application artifact deletion failed";
  return message
    .replace(/run_[A-Za-z0-9_-]+/g, "[private executor id]")
    .slice(0, 500);
}

function isEligible(
  artifact: ApplicationArtifactRecord,
  now: Date,
  stagedCutoff: Date,
): boolean {
  if (artifact.state === "STAGED") return artifact.stagedAt <= stagedCutoff;
  if (artifact.state === "DELETING") {
    return Boolean(
      artifact.claimLeaseExpiresAt && artifact.claimLeaseExpiresAt <= now,
    );
  }
  if (artifact.state !== "DELETE_PENDING") return false;
  if (!artifact.deleteAfter || artifact.deleteAfter > now) return false;
  return !artifact.nextAttemptAt || artifact.nextAttemptAt <= now;
}

type CurrentApplication = {
  id: string;
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
  resumeTexUrl: string | null;
  coverTexUrl: string | null;
};

type CurrentReferenceSearch =
  | { kind: "referenced"; application: CurrentApplication }
  | { kind: "clear" }
  | { kind: "indeterminate" };

function applicationUrls(application: CurrentApplication): (string | null)[] {
  return [
    application.resumePdfUrl,
    application.coverPdfUrl,
    application.resumeTexUrl,
    application.coverTexUrl,
  ];
}

/**
 * Standard Application paths contain only three separators and URL-safe
 * segments. Enumerating literal/percent-encoded separators therefore yields a
 * complete finite alias set (2^3) and avoids a host-wide scan for the normal
 * namespace.
 */
function referencePathCandidates(pathname: string): string[] {
  const candidates = new Set<string>([
    pathname,
    encodeURI(pathname),
    pathname.split("/").map(encodeURIComponent).join("/"),
  ]);
  if (!parseApplicationArtifactPathname(pathname)) {
    return [...candidates];
  }
  const segments = pathname.split("/").map(encodeURIComponent);
  const separators = segments.length - 1;
  for (let mask = 0; mask < 2 ** separators; mask += 1) {
    let candidate = segments[0]!;
    for (let index = 0; index < separators; index += 1) {
      candidate += (mask & (1 << index)) === 0 ? "/" : "%2F";
      candidate += segments[index + 1]!;
    }
    candidates.add(candidate);
  }
  for (const candidate of [...candidates]) {
    candidates.add(`%2F${candidate}`);
  }
  return [...candidates];
}

function matchingCurrentApplication(
  candidates: readonly CurrentApplication[],
  input: { storageKey: string | null; pathname: string },
): CurrentApplication | null {
  return (
    candidates.find((candidate) =>
      applicationUrls(candidate).some((candidateUrl) => {
        if (!candidateUrl) return false;
        const candidateIdentity =
          canonicalizeApplicationArtifactStorageIdentity(candidateUrl);
        if (!candidateIdentity) return false;
        return input.storageKey
          ? candidateIdentity.key === input.storageKey
          : candidateIdentity.pathname === input.pathname;
      }),
    ) ?? null
  );
}

async function currentApplicationReference(
  tx: ApplicationArtifactTransaction,
  artifact: Pick<
    ApplicationArtifactRecord,
    "url" | "pathname" | "contentHash"
  >,
): Promise<CurrentReferenceSearch> {
  const select = {
    id: true,
    resumePdfUrl: true,
    coverPdfUrl: true,
    resumeTexUrl: true,
    coverTexUrl: true,
  } as const;
  if (artifact.url) {
    // Keep the common exact lookup indexable through the four partial indexes.
    const exact = await tx.application.findFirst({
      where: {
        OR: [
          { resumePdfUrl: artifact.url },
          { coverPdfUrl: artifact.url },
          { resumeTexUrl: artifact.url },
          { coverTexUrl: artifact.url },
        ],
      },
      select,
    });
    if (exact) return { kind: "referenced", application: exact };
  }

  const identity = artifact.url
    ? canonicalizeApplicationArtifactStorageIdentity(artifact.url)
    : null;
  const pathname = identity?.pathname ?? artifact.pathname;
  if (!pathname) return { kind: "indeterminate" };
  // Presentation aliases can differ by query, fragment, whitespace, percent
  // encoding, encoded separators, or hostname case. Standard immutable paths
  // have a complete finite separator-alias set, so they never need a broad
  // fallback scan.
  const pathCandidates = referencePathCandidates(pathname);
  const aliasFilters: Prisma.ApplicationWhereInput[] = [];
  for (const candidatePathname of pathCandidates) {
    const urlFilter = (field: "resumePdfUrl" | "coverPdfUrl" | "resumeTexUrl" | "coverTexUrl") => ({
      ...(identity
        ? {
            AND: [
              {
                [field]: {
                  contains: identity.storeHost,
                  mode: "insensitive" as const,
                },
              },
              {
                [field]: {
                  contains: candidatePathname,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {
            [field]: {
              contains: candidatePathname,
              mode: "insensitive" as const,
            },
          }),
    });
    aliasFilters.push(
      urlFilter("resumePdfUrl"),
      urlFilter("coverPdfUrl"),
      urlFilter("resumeTexUrl"),
      urlFilter("coverTexUrl"),
    );
  }
  const candidates = await tx.application.findMany({
    where: { OR: aliasFilters },
    select,
    orderBy: { id: "asc" },
    take: REFERENCE_FALLBACK_MAX_CANDIDATES + 1,
  });
  const matchingCandidate = matchingCurrentApplication(candidates, {
    storageKey: identity?.key ?? null,
    pathname,
  });
  if (matchingCandidate) {
    return { kind: "referenced", application: matchingCandidate };
  }
  if (candidates.length > REFERENCE_FALLBACK_MAX_CANDIDATES) {
    return { kind: "indeterminate" };
  }
  /*
   * A hashed strict path is writer provenance: its URL is generated from this
   * server-owned immutable pathname, whose complete presentation grammar is
   * covered above. Metadata-null rows come from migration/inventory and must
   * take the broader legacy fallback because their URL provenance is unknown.
   */
  if (artifact.contentHash && parseApplicationArtifactPathname(pathname)) {
    return { kind: "clear" };
  }
  /*
   * Arbitrary percent encoding of otherwise URL-safe bytes (for example,
   * `%61pplications`) prevents any practical finite `contains` candidate set
   * from proving absence. Bound the conservative fallback for every path.
   * Reaching the cap is not proof of absence: fail closed instead of
   * authorizing deletion.
   */
  const fallbackWhere: Prisma.ApplicationWhereInput = {
    OR: (
      ["resumePdfUrl", "coverPdfUrl", "resumeTexUrl", "coverTexUrl"] as const
    ).map((field) =>
      identity
        ? {
            [field]: {
              contains: identity.storeHost,
              mode: "insensitive" as const,
            },
          }
        : { [field]: { not: null } },
    ),
  };
  const fallbackCandidates = await tx.application.findMany({
    where: fallbackWhere,
    select,
    orderBy: { id: "asc" },
    take: REFERENCE_FALLBACK_MAX_CANDIDATES + 1,
  });
  const fallbackMatch = matchingCurrentApplication(fallbackCandidates, {
    storageKey: identity?.key ?? null,
    pathname,
  });
  if (fallbackMatch) {
    return { kind: "referenced", application: fallbackMatch };
  }
  return fallbackCandidates.length > REFERENCE_FALLBACK_MAX_CANDIDATES
    ? { kind: "indeterminate" }
    : { kind: "clear" };
}

async function claimArtifact(
  database: ApplicationArtifactDatabase,
  input: {
    artifactId: string;
    now: Date;
    stagedCutoff: Date;
    claimId: string;
    claimLeaseMs: number;
  },
): Promise<ClaimResult> {
  return database.$transaction(async (tx) => {
    let artifact = await tx.applicationArtifact.findUnique({
      where: { id: input.artifactId },
    });
    if (!artifact || !isEligible(artifact, input.now, input.stagedCutoff)) {
      return { kind: "skipped" };
    }

    if (artifact.jobId) {
      await acquireApplicationMutationLock(
        tx as unknown as Prisma.TransactionClient,
        artifact.userId,
        artifact.jobId,
      );
      artifact = await tx.applicationArtifact.findUnique({
        where: { id: artifact.id },
      });
      if (!artifact || !isEligible(artifact, input.now, input.stagedCutoff)) {
        return { kind: "skipped" };
      }
    }

    const current = await currentApplicationReference(tx, artifact);
    if (current.kind === "indeterminate") {
      return { kind: "protected" };
    }
    if (current.kind === "referenced") {
      /*
       * Only an active URL-known stage may become REFERENCED. Retirement is a
       * permanent pathname tombstone, and a pathname-only match may belong to
       * another store so it cannot safely supply this row's physical identity.
       */
      if (artifact.state !== "STAGED" || !artifact.url) {
        return { kind: "protected" };
      }
      const protectedRow = await tx.applicationArtifact.updateMany({
        where: {
          id: artifact.id,
          state: "STAGED",
        },
        data: {
          state: "REFERENCED",
          applicationId: current.application.id,
          referencedAt: artifact.referencedAt ?? input.now,
          deleteAfter: null,
          deleteRequestedAt: null,
          nextAttemptAt: null,
          claimId: null,
          claimLeaseExpiresAt: null,
          lastError: null,
          deletedAt: null,
          retryCount: 0,
        },
      });
      return protectedRow.count === 1
        ? { kind: "protected" }
        : { kind: "skipped" };
    }

    const claimed = await tx.applicationArtifact.updateMany({
      where: {
        id: artifact.id,
        state: artifact.state,
        ...(artifact.state === "DELETING"
          ? {
              claimId: artifact.claimId,
              claimLeaseExpiresAt: artifact.claimLeaseExpiresAt,
            }
          : {}),
      },
      data: {
        state: "DELETING",
        deleteAfter: artifact.deleteAfter ?? input.now,
        deleteRequestedAt: artifact.deleteRequestedAt ?? input.now,
        nextAttemptAt: null,
        claimId: input.claimId,
        claimLeaseExpiresAt: new Date(input.now.getTime() + input.claimLeaseMs),
        lastError: null,
        deletedAt: null,
      },
    });
    if (claimed.count !== 1) return { kind: "skipped" };
    return {
      kind: "claimed",
      claimId: input.claimId,
      artifact: {
        ...artifact,
        state: "DELETING",
        deleteAfter: artifact.deleteAfter ?? input.now,
        deleteRequestedAt: artifact.deleteRequestedAt ?? input.now,
        nextAttemptAt: null,
        claimId: input.claimId,
        claimLeaseExpiresAt: new Date(input.now.getTime() + input.claimLeaseMs),
        lastError: null,
      },
    };
  });
}

type DeleteAuthorization =
  | { kind: "authorized"; artifact: ApplicationArtifactRecord }
  | { kind: "protected" }
  | { kind: "fenced" };

/**
 * A claim is not authority to delete forever. Re-enter a short transaction
 * immediately before Blob I/O, take JOBA, and re-check both the fenced claim
 * and every live Application pointer. New writers observe DELETING under the
 * same lock, so once this returns authorized they cannot re-reference it.
 */
async function authorizeClaimedDeletion(
  database: ApplicationArtifactDatabase,
  input: {
    artifactId: string;
    claimId: string;
    now: Date;
  },
): Promise<DeleteAuthorization> {
  return database.$transaction(async (tx) => {
    let artifact = await tx.applicationArtifact.findUnique({
      where: { id: input.artifactId },
    });
    if (
      !artifact ||
      artifact.state !== "DELETING" ||
      artifact.claimId !== input.claimId
    ) {
      return { kind: "fenced" };
    }
    if (artifact.jobId) {
      await acquireApplicationMutationLock(
        tx as unknown as Prisma.TransactionClient,
        artifact.userId,
        artifact.jobId,
      );
      artifact = await tx.applicationArtifact.findUnique({
        where: { id: input.artifactId },
      });
      if (
        !artifact ||
        artifact.state !== "DELETING" ||
        artifact.claimId !== input.claimId
      ) {
        return { kind: "fenced" };
      }
    }
    const current = await currentApplicationReference(tx, artifact);
    if (current.kind === "clear") return { kind: "authorized", artifact };

    /*
     * Authorization uncertainty and a newly current pointer both fail closed.
     * Release the claim back to its tombstoned queue state; never resurrect a
     * DELETE_PENDING/DELETING pathname as REFERENCED.
     */
    const protectedRow = await tx.applicationArtifact.updateMany({
      where: {
        id: artifact.id,
        state: "DELETING",
        claimId: input.claimId,
      },
      data: {
        state: "DELETE_PENDING",
        deleteAfter: artifact.deleteAfter ?? input.now,
        deleteRequestedAt: artifact.deleteRequestedAt ?? input.now,
        nextAttemptAt: new Date(input.now.getTime() + RETRY_BASE_MS),
        claimId: null,
        claimLeaseExpiresAt: null,
        lastError:
          current.kind === "indeterminate"
            ? "Application reference check exceeded its safety budget"
            : "Application artifact pathname is still referenced",
        deletedAt: null,
      },
    });
    return protectedRow.count === 1
      ? { kind: "protected" }
      : { kind: "fenced" };
  });
}

async function settleDeleted(
  database: ApplicationArtifactDatabase,
  input: {
    artifactId: string;
    claimId: string;
    now: Date;
  },
): Promise<boolean> {
  return database.$transaction(async (tx) => {
    const settled = await tx.applicationArtifact.updateMany({
      where: {
        id: input.artifactId,
        state: "DELETING",
        claimId: input.claimId,
      },
      data: {
        state: "DELETED",
        deletedAt: input.now,
        deleteAfter: null,
        nextAttemptAt: null,
        claimId: null,
        claimLeaseExpiresAt: null,
        lastError: null,
      },
    });
    return settled.count === 1;
  });
}

function retryDelayMs(retryCount: number): number {
  return Math.min(
    RETRY_BASE_MS * 2 ** Math.min(Math.max(retryCount, 0), 10),
    RETRY_MAX_MS,
  );
}

async function settleRetry(
  database: ApplicationArtifactDatabase,
  input: {
    artifact: ApplicationArtifactRecord;
    claimId: string;
    now: Date;
    error: unknown;
  },
): Promise<boolean> {
  return database.$transaction(async (tx) => {
    const settled = await tx.applicationArtifact.updateMany({
      where: {
        id: input.artifact.id,
        state: "DELETING",
        claimId: input.claimId,
      },
      data: {
        state: "DELETE_PENDING",
        deleteAfter: input.artifact.deleteAfter ?? input.now,
        deleteRequestedAt: input.artifact.deleteRequestedAt ?? input.now,
        retryCount: { increment: 1 },
        nextAttemptAt: new Date(
          input.now.getTime() + retryDelayMs(input.artifact.retryCount),
        ),
        claimId: null,
        claimLeaseExpiresAt: null,
        lastError: boundedError(input.error),
        deletedAt: null,
      },
    });
    return settled.count === 1;
  });
}

async function registerInventoryBlob(
  database: ApplicationArtifactDatabase,
  blob: ArtifactBlobObject,
  now: Date,
): Promise<"discovered" | "known" | "ignored"> {
  const pathIdentity = parseApplicationArtifactPathname(blob.pathname);
  const storage = canonicalizeApplicationArtifactStorageIdentity(blob.url);
  if (
    !pathIdentity ||
    !storage ||
    storage.pathname !== decodeURIComponent(blob.pathname)
  ) {
    return "ignored";
  }

  return database.$transaction(async (tx) => {
    await acquireApplicationMutationLock(
      tx as unknown as Prisma.TransactionClient,
      pathIdentity.userId,
      pathIdentity.jobId,
    );
    const owner = await tx.user.findUnique({
      where: { id: pathIdentity.userId },
      select: { id: true },
    });
    const currentSearch = owner
      ? await currentApplicationReference(tx, {
          url: blob.url,
          pathname: blob.pathname,
          contentHash: null,
        })
      : ({ kind: "clear" } as const);
    const current =
      currentSearch.kind === "referenced"
        ? currentSearch.application
        : null;
    let existing = await tx.applicationArtifact.findUnique({
      where: { storageIdentity: storage.key },
    });
    if (!existing) {
      const provisional = await tx.applicationArtifact.findUnique({
        where: { provisionalIdentity: `pending:${blob.pathname}` },
      });
      if (
        provisional &&
        provisional.userId === pathIdentity.userId &&
        provisional.jobId === pathIdentity.jobId &&
        provisional.target === pathIdentity.target &&
        provisional.pathname === blob.pathname
      ) {
        /*
         * A drain worker can own a pathname-only row while inventory observes
         * the just-uploaded Blob. Its fenced DELETING claim remains the sole
         * authority; creating a second storage-identity row here would split
         * ownership of one physical object.
         */
        if (provisional.state === "DELETING") return "known";
        const adopted = await tx.applicationArtifact.updateMany({
          where: {
            id: provisional.id,
            state: provisional.state,
            provisionalIdentity: `pending:${blob.pathname}`,
          },
          data:
            provisional.state === "DELETE_PENDING" ||
            provisional.state === "DELETED" ||
            !owner
              ? {
                  state: "DELETE_PENDING",
                  applicationId: null,
                  url: blob.url,
                  storeHost: storage.storeHost,
                  storageIdentity: storage.key,
                  provisionalIdentity: null,
                  referencedAt: null,
                  deleteAfter: provisional.deleteAfter ?? now,
                  deleteRequestedAt: provisional.deleteRequestedAt ?? now,
                  deletedAt: null,
                  retryCount:
                    provisional.state === "DELETE_PENDING"
                      ? provisional.retryCount
                      : 0,
                  nextAttemptAt:
                    provisional.state === "DELETE_PENDING"
                      ? provisional.nextAttemptAt
                      : null,
                  claimId: null,
                  claimLeaseExpiresAt: null,
                  lastError:
                    provisional.state === "DELETE_PENDING"
                      ? provisional.lastError
                      : null,
                  inventorySeenAt: now,
                }
              : current
                ? {
                state: "REFERENCED",
                applicationId: current.id,
                url: blob.url,
                storeHost: storage.storeHost,
                storageIdentity: storage.key,
                provisionalIdentity: null,
                referencedAt: provisional.referencedAt ?? now,
                deleteAfter: null,
                deleteRequestedAt: null,
                deletedAt: null,
                retryCount: 0,
                nextAttemptAt: null,
                claimId: null,
                claimLeaseExpiresAt: null,
                lastError: null,
                inventorySeenAt: now,
              }
                : {
                    url: blob.url,
                    storeHost: storage.storeHost,
                    storageIdentity: storage.key,
                    provisionalIdentity: null,
                    inventorySeenAt: now,
                  },
        });
        if (adopted.count === 1) return "known";
      }
      existing = await tx.applicationArtifact.findUnique({
        where: { storageIdentity: storage.key },
      });
    }
    if (!existing) {
      const inserted = await tx.applicationArtifact.createMany({
        data: [
          {
            userId: pathIdentity.userId,
            jobId: pathIdentity.jobId,
            applicationId: current?.id ?? null,
            target: pathIdentity.target,
            state: current ? "REFERENCED" : owner ? "STAGED" : "DELETE_PENDING",
            pathname: blob.pathname,
            url: blob.url,
            storeHost: storage.storeHost,
            storageIdentity: storage.key,
            provisionalIdentity: null,
            contentVersion: null,
            contentHash: null,
            stagedAt: now,
            referencedAt: current ? now : null,
            ...(!owner
              ? {
                  deleteAfter: now,
                  deleteRequestedAt: now,
                }
              : {}),
            inventorySeenAt: now,
          },
        ],
        skipDuplicates: true,
      });
      existing = await tx.applicationArtifact.findUnique({
        where: { storageIdentity: storage.key },
      });
      if (!existing) {
        throw new Error("Artifact inventory identity could not be persisted");
      }
      if (inserted.count === 1) return "discovered";
    }

    if (!owner && existing.state !== "DELETING") {
      await tx.applicationArtifact.updateMany({
        where: { id: existing.id, state: existing.state },
        data: {
          state: "DELETE_PENDING",
          applicationId: null,
          url: blob.url,
          storeHost: storage.storeHost,
          storageIdentity: storage.key,
          provisionalIdentity: null,
          referencedAt: null,
          deleteAfter: existing.deleteAfter ?? now,
          deleteRequestedAt: existing.deleteRequestedAt ?? now,
          deletedAt: null,
          retryCount:
            existing.state === "DELETE_PENDING" ? existing.retryCount : 0,
          nextAttemptAt:
            existing.state === "DELETE_PENDING" ? existing.nextAttemptAt : null,
          claimId: null,
          claimLeaseExpiresAt: null,
          lastError:
            existing.state === "DELETE_PENDING" ? existing.lastError : null,
          inventorySeenAt: now,
        },
      });
    } else if (
      current &&
      (existing.state === "STAGED" || existing.state === "REFERENCED")
    ) {
      await tx.applicationArtifact.updateMany({
        where: { id: existing.id, state: existing.state },
        data: {
          state: "REFERENCED",
          applicationId: current.id,
          url: blob.url,
          storeHost: storage.storeHost,
          storageIdentity: storage.key,
          provisionalIdentity: null,
          referencedAt: existing.referencedAt ?? now,
          deleteAfter: null,
          deleteRequestedAt: null,
          deletedAt: null,
          retryCount: 0,
          nextAttemptAt: null,
          claimId: null,
          claimLeaseExpiresAt: null,
          lastError: null,
          inventorySeenAt: now,
        },
      });
    } else if (existing.state === "DELETED") {
      await tx.applicationArtifact.update({
        where: { id: existing.id },
        data: {
          state: "DELETE_PENDING",
          applicationId: null,
          url: blob.url,
          storeHost: storage.storeHost,
          storageIdentity: storage.key,
          provisionalIdentity: null,
          referencedAt: null,
          deleteAfter: now,
          deleteRequestedAt: existing.deleteRequestedAt ?? now,
          deletedAt: null,
          retryCount: 0,
          nextAttemptAt: null,
          claimId: null,
          claimLeaseExpiresAt: null,
          lastError: null,
          inventorySeenAt: now,
        },
      });
    } else if (
      existing.state === "REFERENCED" &&
      currentSearch.kind === "clear"
    ) {
      await tx.applicationArtifact.updateMany({
        where: { id: existing.id, state: "REFERENCED" },
        data: {
          state: "STAGED",
          applicationId: null,
          url: blob.url,
          storeHost: storage.storeHost,
          storageIdentity: storage.key,
          provisionalIdentity: null,
          stagedAt: now,
          referencedAt: null,
          deleteAfter: null,
          deleteRequestedAt: null,
          deletedAt: null,
          retryCount: 0,
          nextAttemptAt: null,
          claimId: null,
          claimLeaseExpiresAt: null,
          lastError: null,
          inventorySeenAt: now,
        },
      });
    } else {
      await tx.applicationArtifact.updateMany({
        where: { id: existing.id, state: existing.state },
        data: { inventorySeenAt: now },
      });
    }
    return "known";
  });
}

type InventoryCheckpointClaim =
  { kind: "claimed"; claimId: string; cursor?: string } | { kind: "busy" };

async function claimInventoryCheckpoint(input: {
  database: ApplicationArtifactDatabase;
  claimId: string;
  now: Date;
  leaseMs: number;
}): Promise<InventoryCheckpointClaim> {
  return input.database.$transaction(async (tx) => {
    await tx.applicationArtifactInventoryCheckpoint.createMany({
      data: [
        {
          key: INVENTORY_CHECKPOINT_KEY,
          cursor: null,
          claimId: null,
          claimLeaseExpiresAt: null,
          scanStartedAt: null,
          completedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        },
      ],
      skipDuplicates: true,
    });
    const checkpoint =
      await tx.applicationArtifactInventoryCheckpoint.findUnique({
        where: { key: INVENTORY_CHECKPOINT_KEY },
      });
    if (!checkpoint)
      throw new Error("Artifact inventory checkpoint is missing");
    if (
      checkpoint.claimId &&
      checkpoint.claimLeaseExpiresAt &&
      checkpoint.claimLeaseExpiresAt > input.now
    ) {
      return { kind: "busy" };
    }
    const claimed = await tx.applicationArtifactInventoryCheckpoint.updateMany({
      where: {
        key: INVENTORY_CHECKPOINT_KEY,
        OR: [
          { claimId: null, claimLeaseExpiresAt: null },
          { claimLeaseExpiresAt: { lte: input.now } },
        ],
      },
      data: {
        claimId: input.claimId,
        claimLeaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
        scanStartedAt: checkpoint.cursor
          ? (checkpoint.scanStartedAt ?? input.now)
          : input.now,
      },
    });
    if (claimed.count !== 1) return { kind: "busy" };
    return {
      kind: "claimed",
      claimId: input.claimId,
      ...(checkpoint.cursor ? { cursor: checkpoint.cursor } : {}),
    };
  });
}

async function checkpointInventoryProgress(input: {
  database: ApplicationArtifactDatabase;
  claimId: string;
  cursor: string | null;
  now: Date;
  leaseMs: number;
  release: boolean;
  completed: boolean;
}): Promise<boolean> {
  return input.database.$transaction(async (tx) => {
    const advanced = await tx.applicationArtifactInventoryCheckpoint.updateMany(
      {
        where: {
          key: INVENTORY_CHECKPOINT_KEY,
          claimId: input.claimId,
        },
        data: {
          cursor: input.cursor,
          ...(input.release
            ? { claimId: null, claimLeaseExpiresAt: null }
            : {
                claimLeaseExpiresAt: new Date(
                  input.now.getTime() + input.leaseMs,
                ),
              }),
          ...(input.completed
            ? {
                scanStartedAt: null,
                completedAt: input.now,
              }
            : {}),
        },
      },
    );
    return advanced.count === 1;
  });
}

async function reconcileInventory(input: {
  database: ApplicationArtifactDatabase;
  blobPort: ArtifactBlobPort;
  now: () => Date;
  randomUuid: () => string;
  pageSize: number;
  pageLimit: number;
  objectLimit: number;
  claimLeaseMs: number;
}): Promise<InventorySummary> {
  let pages = 0;
  let seen = 0;
  let discovered = 0;
  let ignored = 0;
  const claimId = input.randomUuid();
  const claim = await claimInventoryCheckpoint({
    database: input.database,
    claimId,
    now: input.now(),
    leaseMs: input.claimLeaseMs,
  });
  if (claim.kind === "busy") {
    return { status: "busy", pages: 0, seen: 0, discovered: 0, ignored: 0 };
  }
  let cursor = claim.cursor;

  try {
    while (pages < input.pageLimit && seen < input.objectLimit) {
      const remaining = input.objectLimit - seen;
      const page = await input.blobPort.list({
        prefix: APPLICATION_ARTIFACT_PREFIX,
        ...(cursor ? { cursor } : {}),
        limit: Math.min(input.pageSize, remaining),
      });
      pages += 1;
      for (const blob of page.blobs) {
        seen += 1;
        try {
          const result = await registerInventoryBlob(
            input.database,
            blob,
            input.now(),
          );
          if (result === "discovered") discovered += 1;
          if (result === "ignored") ignored += 1;
        } catch {
          ignored += 1;
        }
      }
      if (!page.hasMore) {
        const settled = await checkpointInventoryProgress({
          database: input.database,
          claimId,
          cursor: null,
          now: input.now(),
          leaseMs: input.claimLeaseMs,
          release: true,
          completed: true,
        });
        if (!settled) throw new Error("Artifact inventory claim was fenced");
        return { status: "completed", pages, seen, discovered, ignored };
      }
      if (!page.cursor || page.cursor === cursor) {
        throw new Error("Blob inventory returned a non-advancing cursor");
      }
      cursor = page.cursor;
      const bounded = pages >= input.pageLimit || seen >= input.objectLimit;
      const advanced = await checkpointInventoryProgress({
        database: input.database,
        claimId,
        cursor,
        now: input.now(),
        leaseMs: input.claimLeaseMs,
        release: bounded,
        completed: false,
      });
      if (!advanced) throw new Error("Artifact inventory claim was fenced");
      if (bounded) {
        return { status: "partial", pages, seen, discovered, ignored };
      }
    }
    throw new Error("Artifact inventory budget ended without a checkpoint");
  } catch (error) {
    await checkpointInventoryProgress({
      database: input.database,
      claimId,
      cursor: cursor ?? null,
      now: input.now(),
      leaseMs: input.claimLeaseMs,
      release: true,
      completed: false,
    }).catch(() => false);
    return {
      status: "failed",
      pages,
      seen,
      discovered,
      ignored,
      error: boundedError(error),
      portUnavailable: isArtifactBlobPortUnavailable(error),
    };
  }
}

function candidateWhere(
  artifactIds: readonly string[] | undefined,
  now: Date,
  stagedCutoff: Date,
): Record<string, unknown> {
  return {
    ...(artifactIds !== undefined
      ? { id: { in: [...new Set(artifactIds)] } }
      : {}),
    OR: [
      { state: "STAGED", stagedAt: { lte: stagedCutoff } },
      {
        state: "DELETE_PENDING",
        deleteAfter: { lte: now },
        AND: [
          {
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        ],
      },
      {
        state: "DELETING",
        claimLeaseExpiresAt: { lte: now },
      },
    ],
  };
}

/**
 * Drain durable outbox work first, then spend a bounded budget on inventory.
 * No transaction spans Blob I/O; every claim, pre-delete authorization,
 * settle, and checkpoint advance is independently fenced.
 */
export async function reconcileApplicationArtifacts(
  options: ReconcileApplicationArtifactsOptions = {},
): Promise<ApplicationArtifactReconcileResult> {
  const counters = emptyCounters();
  if (!reconcileEnabled(options.enabled)) {
    return {
      kind: "disabled",
      reason: "ARTIFACT_RECONCILE_DISABLED",
      inventory: disabledInventory(),
      ...counters,
    };
  }

  const database = options.database ?? defaultApplicationArtifactDatabase();
  const blobPort = options.blobPort ?? vercelArtifactBlobPort;
  const clock = options.now ?? (() => new Date());
  const uuid = options.randomUuid ?? randomUUID;
  const stagedGraceMs = Math.max(
    options.stagedGraceMs ?? DEFAULT_STAGED_GRACE_MS,
    0,
  );
  const inventoryEnabled = options.inventory !== false;
  let inventory: InventorySummary = disabledInventory();
  let sawPortUnavailable = false;
  let portUnavailableMessage = "";
  const candidateNow = clock();
  const candidateStagedCutoff = new Date(
    candidateNow.getTime() - stagedGraceMs,
  );
  const candidateLimit = Math.min(
    Math.max(options.limit ?? DEFAULT_LIMIT, 1),
    200,
  );
  await queueArtifactsForAbsentUsers({
    database,
    now: candidateNow,
    stagedCutoff: candidateStagedCutoff,
    limit: candidateLimit,
  });
  const candidates = await database.applicationArtifact.findMany({
    where: candidateWhere(
      options.artifactIds,
      candidateNow,
      candidateStagedCutoff,
    ),
    orderBy: [{ deleteAfter: "asc" }, { stagedAt: "asc" }, { id: "asc" }],
    take: candidateLimit,
  });

  for (const candidate of candidates) {
    const claimNow = clock();
    const claim = await claimArtifact(database, {
      artifactId: candidate.id,
      now: claimNow,
      stagedCutoff: new Date(claimNow.getTime() - stagedGraceMs),
      claimId: uuid(),
      claimLeaseMs: Math.max(
        options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS,
        10_000,
      ),
    });
    if (claim.kind === "protected") {
      counters.protected += 1;
      continue;
    }
    if (claim.kind === "skipped") continue;
    counters.claimed += 1;

    const authorization = await authorizeClaimedDeletion(database, {
      artifactId: claim.artifact.id,
      claimId: claim.claimId,
      now: clock(),
    });
    if (authorization.kind === "protected") {
      counters.protected += 1;
      continue;
    }
    if (authorization.kind === "fenced") {
      counters.fenced += 1;
      continue;
    }

    let deletion: Awaited<ReturnType<ArtifactBlobPort["delete"]>>;
    try {
      deletion = await blobPort.delete(
        authorization.artifact.url ?? authorization.artifact.pathname,
      );
    } catch (error) {
      if (isArtifactBlobPortUnavailable(error)) {
        sawPortUnavailable = true;
        portUnavailableMessage = error.message;
      }
      const settled = await settleRetry(database, {
        artifact: authorization.artifact,
        claimId: claim.claimId,
        now: clock(),
        error,
      });
      if (settled) counters.retried += 1;
      else counters.fenced += 1;
      continue;
    }

    const settled = await settleDeleted(database, {
      artifactId: authorization.artifact.id,
      claimId: claim.claimId,
      now: clock(),
    });
    if (!settled) {
      counters.fenced += 1;
      continue;
    }
    if (deletion.disposition === "not_found") counters.notFound += 1;
    else counters.deleted += 1;
  }

  await purgeDeletedArtifactsForAbsentUsers({
    database,
    limit: candidateLimit,
  });

  if (inventoryEnabled) {
    inventory = await reconcileInventory({
      database,
      blobPort,
      now: clock,
      randomUuid: uuid,
      pageSize: Math.min(
        Math.max(options.inventoryPageSize ?? DEFAULT_INVENTORY_PAGE_SIZE, 1),
        1_000,
      ),
      pageLimit: Math.min(
        Math.max(options.inventoryPageLimit ?? DEFAULT_INVENTORY_PAGE_LIMIT, 1),
        20,
      ),
      objectLimit: Math.min(
        Math.max(
          options.inventoryObjectLimit ?? DEFAULT_INVENTORY_OBJECT_LIMIT,
          1,
        ),
        5_000,
      ),
      claimLeaseMs: Math.max(
        options.inventoryClaimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS,
        10_000,
      ),
    });
    if (inventory.status === "failed" && inventory.portUnavailable) {
      sawPortUnavailable = true;
      portUnavailableMessage = inventory.error;
    }
  }

  if (sawPortUnavailable) {
    return {
      kind: "port_unavailable",
      reason: "ARTIFACT_BLOB_PORT_UNAVAILABLE",
      message:
        portUnavailableMessage ||
        "Application artifact Blob storage is not configured",
      inventory,
      ...counters,
    };
  }
  return { kind: "completed", inventory, ...counters };
}
