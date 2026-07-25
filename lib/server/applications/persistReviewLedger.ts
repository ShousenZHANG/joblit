import type { Prisma } from "@/lib/generated/prisma";
import {
  canonicalJson,
  sha256,
  stableClaimId,
} from "@/lib/server/applications/evidenceHashing";
import { assertCanonicalEvidenceReferences } from "@/lib/server/ai/evidenceLedger";
import { addedBulletText, proposalText } from "@/lib/shared/aiContentText";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

type PersistReviewLedgerInput = {
  userId: string;
  applicationId: string;
  jobId: string | null;
  aiContent: AiContent;
};

type ClaimInput = {
  key: string;
  text: string;
  evidenceIds: readonly string[];
};

function collectClaims(aiContent: AiContent): ClaimInput[] {
  const claims: ClaimInput[] = [
    {
      key: "cv.summary",
      text: proposalText(aiContent.cv.summary),
      evidenceIds: aiContent.cv.summary.evidenceIds ?? [],
    },
    // The index is the position among accepted bullets, not among all of them.
    // It feeds stableClaimId, so renumbering would orphan existing ledger rows.
    ...aiContent.cv.latestExperience.addedBullets
      .filter((bullet) => bullet.accepted)
      .map((bullet, index) => ({
        key: `cv.latestExperience.addedBullets[${index}]`,
        text: addedBulletText(bullet),
        evidenceIds: bullet.evidenceIds ?? [],
      })),
    ...(
      [
        ["cover.paragraphOne", aiContent.cover.paragraphOne],
        ["cover.paragraphTwo", aiContent.cover.paragraphTwo],
        ["cover.paragraphThree", aiContent.cover.paragraphThree],
      ] as const
    ).map(([key, value]) => ({
      key,
      text: proposalText(value),
      evidenceIds: value.evidenceIds ?? [],
    })),
  ];
  return claims.filter(
    (claim) => claim.text.length > 0 && claim.evidenceIds.length > 0,
  );
}

/**
 * Persist the immutable evidence/claim projection for one committed AI draft.
 *
 * Existing content-addressed evidence is reused. Claim edges are append-only
 * and idempotent, so a retry cannot duplicate the audit trail.
 */
export async function persistReviewLedger(
  tx: Prisma.TransactionClient,
  input: PersistReviewLedgerInput,
) {
  const evidence = input.aiContent.evidence ?? [];
  if (evidence.length === 0) return;
  assertCanonicalEvidenceReferences(input.userId, evidence);

  await tx.evidenceSnapshot.createMany({
    data: evidence.map((item) => ({
      id: item.id,
      userId: input.userId,
      applicationId: input.applicationId,
      jobId: input.jobId,
      kind:
        item.kind === "candidate"
          ? ("RESUME_PROFILE" as const)
          : ("JOB_DESCRIPTION" as const),
      contentHash: item.contentHash,
      payload: {
        path: item.path,
        excerpt: item.excerpt,
      },
      sourceLabel: item.path,
    })),
    skipDuplicates: true,
  });

  const evidenceIds = new Set(evidence.map((item) => item.id));
  const claimRows = collectClaims(input.aiContent).flatMap((claim) => {
    const claimHash = sha256(
      canonicalJson({ claimKey: claim.key, claimText: claim.text }),
    );
    return claim.evidenceIds
      .filter((evidenceId) => evidenceIds.has(evidenceId))
      .map((evidenceId) => ({
        id: stableClaimId(
          input.userId,
          input.applicationId,
          claimHash,
          evidenceId,
        ),
        userId: input.userId,
        applicationId: input.applicationId,
        evidenceSnapshotId: evidenceId,
        claimKey: claim.key,
        claimText: claim.text,
        claimHash,
        evidencePath:
          evidence.find((item) => item.id === evidenceId)?.path ?? null,
      }));
  });
  if (claimRows.length === 0) return;

  await tx.claimEvidence.createMany({
    data: claimRows,
    skipDuplicates: true,
  });
}
