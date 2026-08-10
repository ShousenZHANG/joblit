import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import {
  buildApplicationPublicationRenderContext,
  projectApplicationPublication,
} from "@/lib/server/applications/applicationPublication";
import { buildPdfFilename, resumeFilenameSegments } from "@/lib/server/files/pdfFilename";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";
import {
  applicationReviewSnapshotSchema,
  type ApplicationReviewSnapshot,
} from "@/lib/shared/schemas/applicationReviewSnapshot";

export type LegacyApplicationReview = {
  applicationId: string;
  jobId: string | null;
  jobTitle: string;
  company: string;
  resumePdfUrl: string | null;
  invalidShape: boolean;
};

export type ApplicationReviewSnapshotResult =
  | { kind: "ready"; snapshot: ApplicationReviewSnapshot }
  | { kind: "legacy"; application: LegacyApplicationReview }
  | { kind: "busy" }
  | { kind: "not_found" };

/**
 * Load one owned Application into the canonical tailoring-editor projection.
 *
 * Callers do not need to know how legacy rows, bound/fallback profiles,
 * document publication hashes, or download filenames are reconstructed.
 */
export async function loadApplicationReviewSnapshot(input: {
  userId: string;
  applicationId: string;
}): Promise<ApplicationReviewSnapshotResult> {
  const application = await prisma.application.findFirst({
    where: { id: input.applicationId, userId: input.userId },
    select: {
      id: true,
      status: true,
      aiContent: true,
      aiContentHash: true,
      resumePdfUrl: true,
      resumePdfName: true,
      coverPdfUrl: true,
      resumeContentHash: true,
      coverContentHash: true,
      resumePublishedHash: true,
      coverPublishedHash: true,
      role: true,
      company: true,
      jobId: true,
      resumeProfileId: true,
      job: {
        select: {
          id: true,
          userId: true,
          title: true,
          company: true,
          location: true,
          market: true,
        },
      },
      resumeProfile: {
        select: {
          userId: true,
          summary: true,
          basics: true,
          links: true,
          skills: true,
          experiences: true,
          projects: true,
          education: true,
        },
      },
    },
  });

  if (!application) return { kind: "not_found" };

  // Application ownership is necessary but not sufficient: legacy/manual
  // writes can bind tenant-scoped foreign keys without a compound constraint.
  // Never project another tenant's Job or ResumeProfile through this endpoint.
  if (
    (application.job && application.job.userId !== input.userId) ||
    (application.resumeProfile &&
      application.resumeProfile.userId !== input.userId)
  ) {
    return { kind: "not_found" };
  }

  if (application.jobId) {
    const activeRun = await prisma.tailoringRun.findFirst({
      where: {
        userId: input.userId,
        jobId: application.jobId,
        status: { in: ["ISSUED", "RUNNING"] },
      },
      select: { id: true },
    });
    if (activeRun) return { kind: "busy" };
  }

  const jobTitle = application.job?.title ?? application.role ?? "Untitled";
  const company = application.job?.company ?? application.company ?? null;
  const legacy = (invalidShape: boolean): ApplicationReviewSnapshotResult => ({
    kind: "legacy",
    application: {
      applicationId: application.id,
      jobId: application.jobId,
      jobTitle,
      company: company ?? "",
      resumePdfUrl: application.resumePdfUrl,
      invalidShape,
    },
  });

  if (!application.aiContent) return legacy(false);
  const parsedAiContent = aiContentSchema.safeParse(application.aiContent);
  if (!parsedAiContent.success) return legacy(true);

  const market = application.job?.market ?? "AU";
  const profile =
    application.resumeProfile ??
    (await getResumeProfile(input.userId, {
      profileId: application.resumeProfileId ?? undefined,
      locale: marketStringToResumeLocale(market),
    }));
  if (!profile) return legacy(true);

  const publication = projectApplicationPublication({
    aiContent: parsedAiContent.data,
    record: {
      status: application.status,
      aiContentHash: application.aiContentHash,
      resumePdfUrl: application.resumePdfUrl,
      coverPdfUrl: application.coverPdfUrl,
      resumeContentHash: application.resumeContentHash,
      coverContentHash: application.coverContentHash,
      resumePublishedHash: application.resumePublishedHash,
      coverPublishedHash: application.coverPublishedHash,
    },
    renderContext: buildApplicationPublicationRenderContext({
      profile,
      job: { title: jobTitle, company, market },
    }),
  });
  const candidateName = resumeFilenameSegments(profile).name;
  const generatedResumeName = buildPdfFilename(candidateName, jobTitle, "cv");

  return {
    kind: "ready",
    snapshot: applicationReviewSnapshotSchema.parse({
      applicationId: application.id,
      publication,
      aiContentHash: application.aiContentHash,
      aiContent: parsedAiContent.data,
      documents: {
        resume: {
          pdfUrl: application.resumePdfUrl,
          pdfName: application.resumePdfName?.trim() || generatedResumeName,
        },
        cover: {
          pdfUrl: application.coverPdfUrl,
          pdfName: buildPdfFilename(candidateName, jobTitle, "cl"),
        },
      },
      job: {
        id: application.job?.id ?? null,
        title: jobTitle,
        company,
        location: application.job?.location ?? null,
        market,
      },
    }),
  };
}
