import type { EvidenceKind, Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { CareerConflictError, CareerNotFoundError } from "./errors";
import {
  canonicalJson,
  contentHash,
  sha256,
  stableClaimId,
  stableEvidenceId,
} from "./hashing";

type EvidenceInput = {
  applicationId?: string;
  jobId?: string;
  kind: EvidenceKind;
  payload: unknown;
  sourceLabel?: string;
};

export async function createEvidenceSnapshot(userId: string, input: EvidenceInput) {
  const normalizedPayload = JSON.parse(canonicalJson(input.payload)) as Prisma.InputJsonValue;
  const hash = contentHash(normalizedPayload);
  const id = stableEvidenceId(userId, input.kind, hash);

  return prisma.$transaction(async (tx) => {
    if (input.jobId) {
      const job = await tx.job.findFirst({
        where: { id: input.jobId, userId },
        select: { id: true },
      });
      if (!job) throw new CareerNotFoundError("job");
    }
    if (input.applicationId) {
      const application = await tx.application.findFirst({
        where: { id: input.applicationId, userId },
        select: { id: true, jobId: true },
      });
      if (!application) throw new CareerNotFoundError("application");
      if (input.jobId && application.jobId && application.jobId !== input.jobId) {
        throw new CareerConflictError(
          "EVIDENCE_SCOPE_MISMATCH",
          "Application and job do not belong to the same career record",
        );
      }
    }

    return tx.evidenceSnapshot.upsert({
      where: { id },
      create: {
        id,
        userId,
        applicationId: input.applicationId,
        jobId: input.jobId,
        kind: input.kind,
        contentHash: hash,
        payload: normalizedPayload,
        sourceLabel: input.sourceLabel,
      },
      update: {},
    });
  });
}

export async function attachClaimEvidence(
  userId: string,
  input: {
    applicationId: string;
    evidenceSnapshotId: string;
    claimKey: string;
    claimText: string;
    evidencePath?: string;
  },
) {
  const normalizedClaim = input.claimText.replace(/\s+/g, " ").trim();
  const claimHash = sha256(canonicalJson({
    claimKey: input.claimKey,
    claimText: normalizedClaim,
  }));
  const id = stableClaimId(
    userId,
    input.applicationId,
    claimHash,
    input.evidenceSnapshotId,
  );

  return prisma.$transaction(async (tx) => {
    const [application, evidence] = await Promise.all([
      tx.application.findFirst({
        where: { id: input.applicationId, userId },
        select: { id: true },
      }),
      tx.evidenceSnapshot.findFirst({
        where: { id: input.evidenceSnapshotId, userId },
        select: { id: true },
      }),
    ]);
    if (!application) throw new CareerNotFoundError("application");
    if (!evidence) throw new CareerNotFoundError("evidence");

    return tx.claimEvidence.upsert({
      where: { id },
      create: {
        id,
        userId,
        applicationId: application.id,
        evidenceSnapshotId: evidence.id,
        claimKey: input.claimKey,
        claimText: normalizedClaim,
        claimHash,
        evidencePath: input.evidencePath,
      },
      update: {},
    });
  });
}

export function listEvidence(
  userId: string,
  options: {
    applicationId?: string;
    jobId?: string;
    kind?: EvidenceKind;
    limit?: number;
  },
) {
  return prisma.evidenceSnapshot.findMany({
    where: {
      userId,
      ...(options.applicationId ? { applicationId: options.applicationId } : {}),
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 50, 1), 100),
  });
}

export function listClaimEvidence(userId: string, applicationId: string) {
  return prisma.claimEvidence.findMany({
    where: { userId, applicationId },
    include: { evidenceSnapshot: true },
    orderBy: { createdAt: "asc" },
  });
}
