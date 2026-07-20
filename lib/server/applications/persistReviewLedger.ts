import type { Prisma } from "@/lib/generated/prisma";
import { canonicalJson, sha256, stableClaimId } from "@/lib/server/career/hashing";
import { assertCanonicalEvidenceReferences } from "@/lib/server/ai/evidenceLedger";
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

function finalText(value: { aiText: string; userEdit?: string }) {
  return value.userEdit?.trim() || value.aiText.trim();
}

function collectClaims(aiContent: AiContent): ClaimInput[] {
  const claims: ClaimInput[] = [
    {
      key: "cv.summary",
      text: finalText(aiContent.cv.summary),
      evidenceIds: aiContent.cv.summary.evidenceIds ?? [],
    },
    ...aiContent.cv.latestExperience.addedBullets
      .filter((bullet) => bullet.accepted)
      .map((bullet, index) => ({
        key: `cv.latestExperience.addedBullets[${index}]`,
        text: bullet.userEdit?.trim() || bullet.text.trim(),
        evidenceIds: bullet.evidenceIds ?? [],
      })),
    ...aiContent.cv.skillsAdditions
      .filter((group) => group.accepted)
      .map((group, index) => ({
        key: `cv.skillsAdditions[${index}]`,
        text: `${group.label}: ${group.items.join(", ")}`.trim(),
        evidenceIds: group.evidenceIds ?? [],
      })),
    ...(
      [
        ["cover.paragraphOne", aiContent.cover.paragraphOne],
        ["cover.paragraphTwo", aiContent.cover.paragraphTwo],
        ["cover.paragraphThree", aiContent.cover.paragraphThree],
      ] as const
    ).map(([key, value]) => ({
      key,
      text: finalText(value),
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
