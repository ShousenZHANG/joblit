import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import { prisma } from "@/lib/server/prisma";
import { buildApplicationArtifactBlobPath } from "@/lib/server/files/applicationArtifactBlob";
import type { ArtifactBlobBody } from "./artifactBlobPort";
import {
  ApplicationArtifactVersionError,
  buildApplicationArtifactVersionPrefix as buildVersionPrefix,
} from "./applicationArtifactVersion";

export const APPLICATION_ARTIFACT_TARGETS = [
  "RESUME_PDF",
  "COVER_PDF",
  "RESUME_TEX",
  "COVER_TEX",
] as const;

export type ApplicationArtifactTarget =
  (typeof APPLICATION_ARTIFACT_TARGETS)[number];

export const APPLICATION_ARTIFACT_STATES = [
  "STAGED",
  "REFERENCED",
  "DELETE_PENDING",
  "DELETING",
  "DELETED",
] as const;

export type ApplicationArtifactState =
  (typeof APPLICATION_ARTIFACT_STATES)[number];

export type ApplicationArtifactRecord = {
  id: string;
  userId: string;
  jobId: string | null;
  applicationId: string | null;
  target: ApplicationArtifactTarget;
  state: ApplicationArtifactState;
  pathname: string;
  url: string | null;
  storeHost: string | null;
  storageIdentity: string | null;
  provisionalIdentity: string | null;
  contentVersion: string | null;
  contentHash: string | null;
  deleteAfter: Date | null;
  retryCount: number;
  nextAttemptAt: Date | null;
  claimId: string | null;
  claimLeaseExpiresAt: Date | null;
  lastError: string | null;
  stagedAt: Date;
  referencedAt: Date | null;
  deleteRequestedAt: Date | null;
  deletedAt: Date | null;
  inventorySeenAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ApplicationArtifactTransaction = Pick<
  Prisma.TransactionClient,
  | "$executeRaw"
  | "applicationArtifact"
  | "applicationArtifactInventoryCheckpoint"
  | "application"
  | "user"
>;

export type ApplicationArtifactDatabase = ApplicationArtifactTransaction & {
  $transaction<T>(
    callback: (tx: ApplicationArtifactTransaction) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T>;
};

export class ApplicationArtifactConflictError extends Error {
  readonly code = "APPLICATION_ARTIFACT_CONFLICT";
  /**
   * Required, not decorative. `isCodedError` recognises an error by `code` AND
   * a numeric `status`; without one this rendered as a bodyless 500, and an
   * agent client reads any 5xx as "settlement unknown" and replays. Every
   * conflict this class reports is a decision already made about stored
   * artifacts, so replaying it can only burn attempts and park the batch.
   */
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ApplicationArtifactConflictError";
  }
}

export function buildApplicationArtifactVersionPrefix(
  contentVersion: string,
): string {
  try {
    return buildVersionPrefix(contentVersion);
  } catch (error) {
    if (error instanceof ApplicationArtifactVersionError) {
      throw new ApplicationArtifactConflictError(error.message);
    }
    throw error;
  }
}

const DEFAULT_DATABASE = prisma as unknown as ApplicationArtifactDatabase;
const CONTENT_HASH_RE = /^[a-f0-9]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVISIONAL_IDENTITY_PREFIX = "pending:";

export type ApplicationArtifactStorageIdentity = {
  storeHost: string;
  pathname: string;
  key: string;
};

/**
 * Physical Blob identity. URL presentation aliases (whitespace, query,
 * fragment, and percent encoding) converge; hostnames remain part of identity
 * so equal pathnames in different stores never share lifecycle state.
 */
export function canonicalizeApplicationArtifactStorageIdentity(
  value: string,
): ApplicationArtifactStorageIdentity | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const storeHost = parsed.hostname.toLowerCase();
    let decodedPathname: string;
    try {
      decodedPathname = decodeURIComponent(parsed.pathname);
    } catch {
      decodedPathname = parsed.pathname;
    }
    const pathname = decodedPathname.replace(/^\/+/, "");
    if (!storeHost || !pathname) return null;
    return {
      storeHost,
      pathname,
      key: `${storeHost}/${pathname}`,
    };
  } catch {
    return null;
  }
}

function provisionalIdentity(pathname: string): string {
  return `${PROVISIONAL_IDENTITY_PREFIX}${pathname}`;
}

function hasCanonicalWriterPathPresentation(
  url: string,
  pathname: string,
): boolean {
  try {
    const parsed = new URL(url.trim());
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.pathname.replace(/^\/+/, "") === pathname
    );
  } catch {
    return false;
  }
}

function legacyStorageIdentity(value: string): string {
  return `legacy:${value.trim()}`;
}

async function hashArtifactBody(body: ArtifactBlobBody): Promise<string> {
  if (typeof body === "string") {
    return createHash("sha256").update(body).digest("hex");
  }
  if (Buffer.isBuffer(body)) {
    return createHash("sha256").update(body).digest("hex");
  }
  if (ArrayBuffer.isView(body)) {
    return createHash("sha256")
      .update(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      )
      .digest("hex");
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return createHash("sha256")
      .update(new Uint8Array(await body.arrayBuffer()))
      .digest("hex");
  }
  if (body instanceof ArrayBuffer) {
    return createHash("sha256").update(new Uint8Array(body)).digest("hex");
  }
  throw new ApplicationArtifactConflictError(
    "Unsupported artifact content body",
  );
}

function targetPathParts(target: ApplicationArtifactTarget): {
  stem: "resume" | "cover";
  extension: "pdf" | "tex";
} {
  if (target === "RESUME_PDF") return { stem: "resume", extension: "pdf" };
  if (target === "COVER_PDF") return { stem: "cover", extension: "pdf" };
  if (target === "RESUME_TEX") return { stem: "resume", extension: "tex" };
  return { stem: "cover", extension: "tex" };
}

function assertArtifactOwner(input: {
  userId: string;
  jobId: string;
}): void {
  if (
    !UUID_RE.test(input.userId) ||
    !UUID_RE.test(input.jobId)
  ) {
    throw new ApplicationArtifactConflictError(
      "Artifact ownership identifiers must be UUIDs",
    );
  }
}

export function buildImmutableApplicationArtifactPath(input: {
  userId: string;
  jobId: string;
  target: ApplicationArtifactTarget;
  contentVersion: string;
  contentHash: string;
  incarnation?: string;
}): string {
  assertArtifactOwner(input);
  if (!CONTENT_HASH_RE.test(input.contentHash)) {
    throw new ApplicationArtifactConflictError("Invalid artifact content hash");
  }
  if (input.incarnation && !UUID_RE.test(input.incarnation)) {
    throw new ApplicationArtifactConflictError(
      "Invalid artifact path incarnation",
    );
  }
  const immutableVersion =
    `${buildApplicationArtifactVersionPrefix(input.contentVersion)}` +
    input.contentHash +
    (input.incarnation ? `-${input.incarnation.toLowerCase()}` : "");
  const { stem, extension } = targetPathParts(input.target);
  const pdfPath = buildApplicationArtifactBlobPath({
    userId: input.userId,
    jobId: input.jobId,
    target: stem,
    version: immutableVersion,
  });
  return extension === "pdf"
    ? pdfPath
    : pdfPath.replace(/\.pdf$/, ".tex");
}

export type ParsedApplicationArtifactPath = {
  userId: string;
  jobId: string;
  target: ApplicationArtifactTarget;
};

export function parseApplicationArtifactPathname(
  pathname: string,
): ParsedApplicationArtifactPath | null {
  const match =
    /^applications\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(resume|cover)\.[a-zA-Z0-9._-]{1,160}\.(pdf|tex)$/i.exec(
      pathname,
    );
  if (!match || !UUID_RE.test(match[1]!) || !UUID_RE.test(match[2]!)) {
    return null;
  }
  const [, userId, jobId, stem, extension] = match;
  const target = `${stem === "resume" ? "RESUME" : "COVER"}_${extension!.toUpperCase()}` as ApplicationArtifactTarget;
  if (!APPLICATION_ARTIFACT_TARGETS.includes(target)) return null;
  return { userId: userId!, jobId: jobId!, target };
}

function sameStagedIdentity(
  existing: ApplicationArtifactRecord,
  expected: {
    userId: string;
    jobId: string;
    target: ApplicationArtifactTarget;
    pathname: string;
    contentVersion: string;
    contentHash: string;
  },
): boolean {
  return (
    existing.userId === expected.userId &&
    existing.jobId === expected.jobId &&
    existing.target === expected.target &&
    existing.pathname === expected.pathname &&
    existing.contentVersion === expected.contentVersion &&
    existing.contentHash === expected.contentHash
  );
}

export type StageArtifactResult = {
  disposition: "STAGED" | "REPLAYED";
  artifact: ApplicationArtifactRecord;
  pathname: string;
  contentHash: string;
};

/**
 * Persist STAGED before any Blob call. The returned pathname is immutable:
 * an exact retry reuses an active pathname, while different bytes necessarily
 * change it. Once retirement starts, the pathname is a permanent tombstone and
 * the same content is published under a fresh UUID incarnation.
 */
async function stageArtifact(
  input: {
    userId: string;
    jobId: string;
    applicationId?: string | null;
    target: ApplicationArtifactTarget;
    contentVersion: string;
    content: ArtifactBlobBody;
  },
  options: {
    database?: ApplicationArtifactDatabase;
    now?: () => Date;
    randomUuid?: () => string;
  } = {},
): Promise<StageArtifactResult> {
  const database = options.database ?? DEFAULT_DATABASE;
  const now = options.now?.() ?? new Date();
  const contentHash = await hashArtifactBody(input.content);
  const basePathname = buildImmutableApplicationArtifactPath({
    userId: input.userId,
    jobId: input.jobId,
    target: input.target,
    contentVersion: input.contentVersion,
    contentHash,
  });
  const expectedContent = {
    userId: input.userId,
    jobId: input.jobId,
    target: input.target,
    contentVersion: input.contentVersion,
    contentHash,
  };

  return database.$transaction(async (tx) => {
    await acquireApplicationMutationLock(
      tx as unknown as Prisma.TransactionClient,
      input.userId,
      input.jobId,
    );

    const retiredBase = await tx.applicationArtifact.findFirst({
      where: {
        pathname: basePathname,
        state: { in: ["DELETE_PENDING", "DELETING", "DELETED"] },
      },
      orderBy: [{ deleteRequestedAt: "desc" }, { createdAt: "desc" }],
    });

    /*
     * Backfill and inventory can discover a canonical current object before
     * they know its writer metadata. Prefer that REFERENCED row over any
     * pathname-only duplicate, but never over a retirement tombstone.
     */
    const referencedBase = await tx.applicationArtifact.findFirst({
      where: {
        userId: input.userId,
        jobId: input.jobId,
        target: input.target,
        pathname: basePathname,
        state: "REFERENCED",
      },
      orderBy: [
        { referencedAt: "desc" },
        { inventorySeenAt: "desc" },
        { createdAt: "desc" },
      ],
    });
    let baseRequiresIncarnation = false;
    if (referencedBase && !retiredBase) {
      const exact = sameStagedIdentity(referencedBase, {
        ...expectedContent,
        pathname: basePathname,
      });
      const metadataUnbound =
        referencedBase.contentVersion === null &&
        referencedBase.contentHash === null;
      if (!exact && !metadataUnbound) {
        throw new ApplicationArtifactConflictError(
          "Artifact pathname is already bound to different content",
        );
      }
      if (metadataUnbound) {
        if (
          referencedBase.url &&
          hasCanonicalWriterPathPresentation(
            referencedBase.url,
            basePathname,
          )
        ) {
          const adopted = await tx.applicationArtifact.update({
            where: { id: referencedBase.id },
            data: {
              contentVersion: input.contentVersion,
              contentHash,
            },
          });
          return {
            disposition: "REPLAYED",
            artifact: adopted,
            pathname: basePathname,
            contentHash,
          };
        }
        /*
         * A legacy presentation can canonicalize to this path through
         * arbitrary percent encoding. Do not upgrade it into trusted writer
         * provenance; publish a fresh incarnation and retire it at commit.
         */
        baseRequiresIncarnation = true;
      } else {
        return {
          disposition: "REPLAYED",
          artifact: referencedBase,
          pathname: basePathname,
          contentHash,
        };
      }
    } else if (referencedBase) {
      baseRequiresIncarnation = true;
    }

    const baseStaged = await tx.applicationArtifact.findFirst({
      where: {
        userId: input.userId,
        jobId: input.jobId,
        target: input.target,
        pathname: basePathname,
        state: "STAGED",
      },
      orderBy: [
        { stagedAt: "desc" },
        { inventorySeenAt: "desc" },
        { createdAt: "desc" },
      ],
    });
    let adoptableBaseStage: ApplicationArtifactRecord | null = null;
    if (baseStaged && !retiredBase) {
      const exact = sameStagedIdentity(baseStaged, {
        ...expectedContent,
        pathname: basePathname,
      });
      const metadataUnbound =
        baseStaged.contentVersion === null && baseStaged.contentHash === null;
      if (!exact && !metadataUnbound) {
        throw new ApplicationArtifactConflictError(
          "Artifact pathname is already bound to different content",
        );
      }
      if (metadataUnbound) {
        const hasTrustedPresentation = baseStaged.url
          ? hasCanonicalWriterPathPresentation(baseStaged.url, basePathname)
          : baseStaged.provisionalIdentity ===
            provisionalIdentity(basePathname);
        if (hasTrustedPresentation) {
          adoptableBaseStage = baseStaged;
        } else {
          baseRequiresIncarnation = true;
        }
      }
    }

    /*
     * An incarnation remains an exact retry while active. Query REFERENCED
     * and STAGED explicitly: nullable timestamp ordering must never decide
     * state priority.
     */
    const activeReferenced = await tx.applicationArtifact.findFirst({
      where: {
        ...expectedContent,
        state: "REFERENCED",
        ...(retiredBase || baseRequiresIncarnation
          ? { pathname: { not: basePathname } }
          : {}),
      },
      orderBy: [
        { referencedAt: "desc" },
        { createdAt: "desc" },
      ],
    });
    if (activeReferenced) {
      return {
        disposition: "REPLAYED",
        artifact: activeReferenced,
        pathname: activeReferenced.pathname,
        contentHash,
      };
    }
    const activeStaged = await tx.applicationArtifact.findFirst({
      where: {
        ...expectedContent,
        state: "STAGED",
        ...(retiredBase || baseRequiresIncarnation
          ? { pathname: { not: basePathname } }
          : {}),
      },
      orderBy: [{ stagedAt: "desc" }, { createdAt: "desc" }],
    });
    if (activeStaged) {
      const refreshed = await tx.applicationArtifact.update({
        where: { id: activeStaged.id },
        data: {
          stagedAt: now,
          applicationId: input.applicationId ?? activeStaged.applicationId,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      return {
        disposition: "REPLAYED",
        artifact: refreshed,
        pathname: activeStaged.pathname,
        contentHash,
      };
    }

    if (adoptableBaseStage) {
      const refreshed = await tx.applicationArtifact.update({
        where: { id: adoptableBaseStage.id },
        data: {
          stagedAt: now,
          applicationId:
            input.applicationId ?? adoptableBaseStage.applicationId,
          contentVersion: input.contentVersion,
          contentHash,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      return {
        disposition: "REPLAYED",
        artifact: refreshed,
        pathname: basePathname,
        contentHash,
      };
    }

    /*
     * A physical pathname becomes a permanent tombstone as soon as retirement
     * starts. This prevents a late delete from an expired worker claim from
     * deleting bytes uploaded by a later generation (cross-system ABA).
     */
    const pathname =
      baseRequiresIncarnation ||
      Boolean(retiredBase)
        ? buildImmutableApplicationArtifactPath({
            userId: input.userId,
            jobId: input.jobId,
            target: input.target,
            contentVersion: input.contentVersion,
            contentHash,
            incarnation: (options.randomUuid ?? randomUUID)(),
          })
        : basePathname;
    const expected = {
      ...expectedContent,
      pathname,
    };
    const pendingIdentity = provisionalIdentity(pathname);
    const existing = await tx.applicationArtifact.findUnique({
      where: { provisionalIdentity: pendingIdentity },
    });
    if (existing) {
      if (
        existing.state !== "STAGED" &&
        existing.state !== "REFERENCED"
      ) {
        throw new ApplicationArtifactConflictError(
          "Artifact pathname has already entered retirement",
        );
      }
      if (!sameStagedIdentity(existing, expected)) {
        throw new ApplicationArtifactConflictError(
          "Artifact staging identity is already bound to different content",
        );
      }
      if (existing.state === "STAGED") {
        const refreshed = await tx.applicationArtifact.update({
          where: { id: existing.id },
          data: {
            stagedAt: now,
            applicationId: input.applicationId ?? existing.applicationId,
            lastError: null,
            nextAttemptAt: null,
          },
        });
        return {
          disposition: "REPLAYED",
          artifact: refreshed,
          pathname,
          contentHash,
        };
      }
      return {
        disposition: "REPLAYED",
        artifact: existing,
        pathname,
        contentHash,
      };
    }

    const inserted = await tx.applicationArtifact.createMany({
      data: [{
        userId: input.userId,
        jobId: input.jobId,
        applicationId: input.applicationId ?? null,
        target: input.target,
        state: "STAGED",
        pathname,
        url: null,
        storeHost: null,
        storageIdentity: null,
        provisionalIdentity: pendingIdentity,
        contentVersion: input.contentVersion,
        contentHash,
        stagedAt: now,
      }],
      skipDuplicates: true,
    });
    const artifact = await tx.applicationArtifact.findUnique({
      where: { provisionalIdentity: pendingIdentity },
    });
    if (!artifact || !sameStagedIdentity(artifact, expected)) {
      throw new ApplicationArtifactConflictError(
        "Artifact staging identity is already bound to different content",
      );
    }
    return {
      disposition: inserted.count === 1 ? "STAGED" : "REPLAYED",
      artifact,
      pathname,
      contentHash,
    };
  });
}

export const stageApplicationArtifact = stageArtifact;

export async function recordUploadedArtifact(
  input: {
    artifactId: string;
    userId: string;
    pathname: string;
    url: string;
  },
  options: {
    database?: ApplicationArtifactDatabase;
    now?: () => Date;
  } = {},
): Promise<{ disposition: "RECORDED" | "REPLAYED"; artifact: ApplicationArtifactRecord }> {
  const database = options.database ?? DEFAULT_DATABASE;
  const now = options.now?.() ?? new Date();
  const storage = canonicalizeApplicationArtifactStorageIdentity(input.url);
  if (!storage || storage.pathname !== input.pathname) {
    throw new ApplicationArtifactConflictError(
      "Uploaded artifact URL does not identify the staged pathname",
    );
  }
  return database.$transaction(async (tx) => {
    let artifact = await tx.applicationArtifact.findUnique({
      where: { id: input.artifactId },
    });
    if (artifact?.jobId) {
      await acquireApplicationMutationLock(
        tx as unknown as Prisma.TransactionClient,
        artifact.userId,
        artifact.jobId,
      );
      artifact = await tx.applicationArtifact.findUnique({
        where: { id: input.artifactId },
      });
    }
    if (
      !artifact ||
      artifact.userId !== input.userId ||
      artifact.pathname !== input.pathname
    ) {
      throw new ApplicationArtifactConflictError("Staged artifact not found");
    }
    if (
      artifact.storageIdentity === storage.key &&
      (artifact.state === "STAGED" || artifact.state === "REFERENCED")
    ) {
      return { disposition: "REPLAYED", artifact };
    }
    if (
      artifact.url ||
      artifact.state !== "STAGED"
    ) {
      throw new ApplicationArtifactConflictError(
        "Staged artifact cannot accept this upload",
      );
    }
    const identityOwner = await tx.applicationArtifact.findUnique({
      where: { storageIdentity: storage.key },
    });
    if (identityOwner && identityOwner.id !== artifact.id) {
      throw new ApplicationArtifactConflictError(
        "Uploaded physical artifact is already tracked by another ledger row",
      );
    }
    const updated = await tx.applicationArtifact.update({
      where: { id: artifact.id },
      data: {
        url: input.url,
        storeHost: storage.storeHost,
        storageIdentity: storage.key,
        provisionalIdentity: null,
        inventorySeenAt: now,
      },
    });
    return { disposition: "RECORDED", artifact: updated };
  });
}

export type ReferencedArtifactInput = {
  target: ApplicationArtifactTarget;
  pathname: string;
  url: string;
};

export type RetiredArtifactInput = {
  target: ApplicationArtifactTarget;
  url: string;
};

function retirementStorage(url: string): {
  pathname: string;
  storeHost: string | null;
  storageIdentity: string;
} {
  const canonical = canonicalizeApplicationArtifactStorageIdentity(url);
  if (canonical) {
    return {
      pathname: parseApplicationArtifactPathname(canonical.pathname)
        ? canonical.pathname
        : `legacy/${createHash("sha256").update(canonical.key).digest("hex")}`,
      storeHost: canonical.storeHost,
      storageIdentity: canonical.key,
    };
  }
  const storageIdentity = legacyStorageIdentity(url);
  return {
    pathname: `legacy/${createHash("sha256")
      .update(storageIdentity)
      .digest("hex")}`,
    storeHost: null,
    storageIdentity,
  };
}

async function enqueueOneRetirement(
  tx: ApplicationArtifactTransaction,
  input: {
    userId: string;
    jobId: string;
    applicationId?: string | null;
    artifact: RetiredArtifactInput;
    now: Date;
    deleteAfter: Date;
  },
): Promise<number> {
  const storage = retirementStorage(input.artifact.url);
  let existing = await tx.applicationArtifact.findUnique({
    where: { storageIdentity: storage.storageIdentity },
  });
  if (existing) {
    // Backfill intentionally deduplicates a shared physical storage identity
    // to one ledger row. The reconciler checks every Application pointer
    // before deletion, so aliases may reuse it without rewriting snapshots.
    if (existing.state === "DELETED") return 0;
    if (existing.state === "DELETING") return 1;
    const updated = await tx.applicationArtifact.updateMany({
      where: {
        id: existing.id,
        state: { in: ["STAGED", "REFERENCED", "DELETE_PENDING"] },
      },
      data: {
        state: "DELETE_PENDING",
        deleteAfter: input.deleteAfter,
        deleteRequestedAt: input.now,
        nextAttemptAt: null,
        claimId: null,
        claimLeaseExpiresAt: null,
        lastError: null,
      },
    });
    return updated.count;
  }

  const inserted = await tx.applicationArtifact.createMany({
    data: [{
      userId: input.userId,
      jobId: input.jobId,
      applicationId: input.applicationId ?? null,
      target: input.artifact.target,
      state: "DELETE_PENDING",
      pathname: storage.pathname,
      url: input.artifact.url.trim(),
      storeHost: storage.storeHost,
      storageIdentity: storage.storageIdentity,
      provisionalIdentity: null,
      contentVersion: null,
      contentHash: null,
      stagedAt: input.now,
      deleteAfter: input.deleteAfter,
      deleteRequestedAt: input.now,
    }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    return 1;
  }
  existing = await tx.applicationArtifact.findUnique({
    where: { storageIdentity: storage.storageIdentity },
  });
  if (!existing) {
    throw new ApplicationArtifactConflictError(
      "Artifact retirement identity could not be persisted",
    );
  }
  if (existing.state === "DELETED") return 0;
  if (existing.state === "DELETING") return 1;
  const updated = await tx.applicationArtifact.updateMany({
    where: {
      id: existing.id,
      state: { in: ["STAGED", "REFERENCED", "DELETE_PENDING"] },
    },
    data: {
      state: "DELETE_PENDING",
      deleteAfter: input.deleteAfter,
      deleteRequestedAt: input.now,
      nextAttemptAt: null,
      claimId: null,
      claimLeaseExpiresAt: null,
      lastError: null,
    },
  });
  return updated.count;
}

/**
 * Called from the existing Application transaction after JOBA is held.
 * Referencing a DELETING object is forbidden, so claim/commit interleavings
 * resolve by transaction order instead of deleting a newly current URL.
 */
export async function markArtifactsReferencedAndRetireSuperseded(
  tx: ApplicationArtifactTransaction,
  input: {
    userId: string;
    jobId: string;
    applicationId: string;
    referenced: readonly ReferencedArtifactInput[];
    superseded?: readonly RetiredArtifactInput[];
    now?: Date;
    deleteAfter?: Date;
  },
): Promise<{ referenced: number; retired: number }> {
  const now = input.now ?? new Date();
  let referenced = 0;
  const currentIdentities = new Set(
    input.referenced.map((artifact) => {
      const identity =
        canonicalizeApplicationArtifactStorageIdentity(artifact.url);
      if (!identity) {
        throw new ApplicationArtifactConflictError(
          "Referenced artifact URL has no canonical storage identity",
        );
      }
      return identity.key;
    }),
  );

  for (const artifact of input.referenced) {
    const storage =
      canonicalizeApplicationArtifactStorageIdentity(artifact.url);
    if (!storage || storage.pathname !== artifact.pathname) {
      throw new ApplicationArtifactConflictError(
        "Referenced artifact URL does not match its pathname",
      );
    }
    const updated = await tx.applicationArtifact.updateMany({
      where: {
        userId: input.userId,
        jobId: input.jobId,
        target: artifact.target,
        pathname: artifact.pathname,
        storageIdentity: storage.key,
        state: { in: ["STAGED", "REFERENCED"] },
      },
      data: {
        state: "REFERENCED",
        applicationId: input.applicationId,
        referencedAt: now,
        deleteAfter: null,
        deleteRequestedAt: null,
        nextAttemptAt: null,
        claimId: null,
        claimLeaseExpiresAt: null,
        lastError: null,
        retryCount: 0,
      },
    });
    if (updated.count !== 1) {
      throw new ApplicationArtifactConflictError(
        "Artifact was not staged or is already being deleted",
      );
    }
    referenced += 1;
  }

  let retired = 0;
  const retiredIdentities = new Set<string>();
  for (const artifact of input.superseded ?? []) {
    if (!artifact.url) continue;
    const supersededIdentity =
      canonicalizeApplicationArtifactStorageIdentity(artifact.url)?.key ??
      legacyStorageIdentity(artifact.url);
    if (
      currentIdentities.has(supersededIdentity) ||
      retiredIdentities.has(supersededIdentity)
    ) {
      continue;
    }
    retiredIdentities.add(supersededIdentity);
    retired += await enqueueOneRetirement(tx, {
      userId: input.userId,
      jobId: input.jobId,
      applicationId: input.applicationId,
      artifact,
      now,
      deleteAfter: input.deleteAfter ?? now,
    });
  }
  return { referenced, retired };
}

export async function enqueueApplicationArtifactRetirements(
  tx: ApplicationArtifactTransaction,
  input: {
    userId: string;
    jobId: string;
    applicationId?: string | null;
    artifacts: readonly RetiredArtifactInput[];
    now?: Date;
    deleteAfter?: Date;
  },
): Promise<{ queued: number }> {
  const now = input.now ?? new Date();
  let queued = 0;
  const seenIdentities = new Set<string>();
  for (const artifact of input.artifacts) {
    if (!artifact.url) continue;
    const identity =
      canonicalizeApplicationArtifactStorageIdentity(artifact.url)?.key ??
      legacyStorageIdentity(artifact.url);
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    queued += await enqueueOneRetirement(tx, {
      userId: input.userId,
      jobId: input.jobId,
      applicationId: input.applicationId,
      artifact,
      now,
      deleteAfter: input.deleteAfter ?? now,
    });
  }
  return { queued };
}

/**
 * Move every durable artifact row owned by a retiring Job/Application graph to
 * the deletion outbox. This complements URL-pointer backfill: it also catches
 * pathname-only stages and ledger rows no longer present on Application.
 * A live DELETING claim is observed but never stolen.
 */
export async function prepareApplicationArtifactsForJobRetirement(
  tx: ApplicationArtifactTransaction,
  input: {
    userId: string;
    jobIds: readonly string[];
    applicationIds?: readonly string[];
    now?: Date;
  },
): Promise<{ queued: number; deleting: number }> {
  const jobIds = [...new Set(input.jobIds)].sort();
  const applicationIds = [...new Set(input.applicationIds ?? [])].sort();
  if (
    !UUID_RE.test(input.userId) ||
    jobIds.some((id) => !UUID_RE.test(id)) ||
    applicationIds.some((id) => !UUID_RE.test(id))
  ) {
    throw new ApplicationArtifactConflictError(
      "Artifact retirement ownership identifiers must be UUIDs",
    );
  }
  if (jobIds.length === 0 && applicationIds.length === 0) {
    return { queued: 0, deleting: 0 };
  }

  const ownership: Prisma.ApplicationArtifactWhereInput[] = [];
  if (jobIds.length > 0) ownership.push({ jobId: { in: jobIds } });
  if (applicationIds.length > 0) {
    ownership.push({ applicationId: { in: applicationIds } });
  }
  const now = input.now ?? new Date();
  const queued = await tx.applicationArtifact.updateMany({
    where: {
      userId: input.userId,
      OR: ownership,
      state: { in: ["STAGED", "REFERENCED", "DELETE_PENDING"] },
    },
    data: {
      state: "DELETE_PENDING",
      deleteAfter: now,
      deleteRequestedAt: now,
      retryCount: 0,
      nextAttemptAt: null,
      claimId: null,
      claimLeaseExpiresAt: null,
      lastError: null,
      deletedAt: null,
    },
  });
  const deleting = await tx.applicationArtifact.count({
    where: {
      userId: input.userId,
      OR: ownership,
      state: "DELETING",
    },
  });
  return { queued: queued.count, deleting };
}

export type PrepareApplicationArtifactsForAccountErasureResult = {
  queued: number;
  deleting: number;
  purgedDeleted: number;
};

/**
 * Required pre-delete hook for account erasure.
 *
 * The account workflow must call this with the same transaction client that
 * subsequently deletes the User row. It makes every unclaimed tenant artifact
 * immediately eligible for the protected reconciler, including pathname-only
 * STAGED rows whose upload response was lost. A live DELETING lease is not
 * stolen: the owning worker can settle or retry it, and the absent-user sweep
 * remains the eventual safety net after the User transaction commits.
 *
 * DELETED rows no longer represent external bytes and are purged in the same
 * transaction, so a failed User deletion rolls the metadata purge back too.
 */
export async function prepareApplicationArtifactsForAccountErasure(
  tx: ApplicationArtifactTransaction,
  input: {
    userId: string;
    now?: Date;
  },
): Promise<PrepareApplicationArtifactsForAccountErasureResult> {
  if (!UUID_RE.test(input.userId)) {
    throw new ApplicationArtifactConflictError(
      "Account erasure user identifier must be a UUID",
    );
  }
  const now = input.now ?? new Date();
  const queued = await tx.applicationArtifact.updateMany({
    where: {
      userId: input.userId,
      state: { in: ["STAGED", "REFERENCED", "DELETE_PENDING"] },
    },
    data: {
      state: "DELETE_PENDING",
      deleteAfter: now,
      deleteRequestedAt: now,
      retryCount: 0,
      nextAttemptAt: null,
      claimId: null,
      claimLeaseExpiresAt: null,
      lastError: null,
      deletedAt: null,
    },
  });
  // Count only after updateMany has locked every unclaimed row. A worker that
  // already owns a claim may settle concurrently, so the result is
  // intentionally a conservative observation rather than deletion authority.
  const deleting = await tx.applicationArtifact.count({
    where: {
      userId: input.userId,
      state: "DELETING",
    },
  });
  const purgedDeleted = await tx.applicationArtifact.deleteMany({
    where: {
      userId: input.userId,
      state: "DELETED",
    },
  });
  return {
    queued: queued.count,
    deleting,
    purgedDeleted: purgedDeleted.count,
  };
}

/**
 * Removes settled lifecycle metadata only after this transaction proves the
 * User row is absent. Account-erasure reconciliation can call this after the
 * last external object reaches DELETED; it never purges live deletion work.
 */
export async function purgeDeletedApplicationArtifactsForErasedUser(
  tx: ApplicationArtifactTransaction,
  input: {
    userId: string;
  },
): Promise<{ purged: number }> {
  if (!UUID_RE.test(input.userId)) {
    throw new ApplicationArtifactConflictError(
      "Account erasure user identifier must be a UUID",
    );
  }
  const existingUser = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (existingUser) {
    throw new ApplicationArtifactConflictError(
      "Cannot purge artifact lifecycle metadata for an existing user",
    );
  }
  const purged = await tx.applicationArtifact.deleteMany({
    where: {
      userId: input.userId,
      state: "DELETED",
    },
  });
  return { purged: purged.count };
}

/**
 * Durable compensation after upload succeeded but the Application transaction
 * did not. URL-known stages become DELETE_PENDING; pathname-only stages remain
 * STAGED so the expiry reconciler can safely recover an ambiguous upload.
 */
export async function retireStagedArtifacts(
  input: {
    userId: string;
    jobId: string;
    artifactIds: readonly string[];
    now?: Date;
    deleteAfter?: Date;
  },
  options: {
    database?: ApplicationArtifactDatabase;
  } = {},
): Promise<{ queued: number; awaitingUploadResolution: number }> {
  const database = options.database ?? DEFAULT_DATABASE;
  const now = input.now ?? new Date();
  return database.$transaction(async (tx) => {
    await acquireApplicationMutationLock(
      tx as unknown as Prisma.TransactionClient,
      input.userId,
      input.jobId,
    );
    const rows = await tx.applicationArtifact.findMany({
      where: {
        id: { in: [...new Set(input.artifactIds)] },
        userId: input.userId,
        jobId: input.jobId,
        state: "STAGED",
      },
    });
    let queued = 0;
    let awaitingUploadResolution = 0;
    for (const row of rows) {
      if (!row.url) {
        awaitingUploadResolution += 1;
        continue;
      }
      const updated = await tx.applicationArtifact.updateMany({
        where: { id: row.id, state: "STAGED" },
        data: {
          state: "DELETE_PENDING",
          deleteAfter: input.deleteAfter ?? now,
          deleteRequestedAt: now,
          nextAttemptAt: null,
          claimId: null,
          claimLeaseExpiresAt: null,
          lastError: null,
        },
      });
      queued += updated.count;
    }
    return { queued, awaitingUploadResolution };
  });
}

export function defaultApplicationArtifactDatabase(): ApplicationArtifactDatabase {
  return DEFAULT_DATABASE;
}
