import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/server/prisma";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";
import { asRecord, toStringValue } from "@/lib/shared/utils/text";
import { TailorClient } from "./TailorClient";
import { LegacyApplicationBanner } from "./LegacyApplicationBanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TailorPageProps {
  params: Promise<{ id: string }>;
}

export default async function TailorPage({ params }: TailorPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/jobs");
  }
  const userId = session.user.id;
  const { id } = await params;

  const application = await prisma.application.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      aiContent: true,
      aiContentHash: true,
      resumePdfUrl: true,
      resumePdfName: true,
      coverPdfUrl: true,
      role: true,
      company: true,
      jobId: true,
      job: {
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          market: true,
        },
      },
      // Only for the download filename. The raw profile name, not the
      // LaTeX-escaped one mapResumeProfile produces.
      resumeProfile: { select: { basics: true } },
    },
  });

  if (!application) {
    redirect("/jobs");
  }

  // Legacy migration path: rows that pre-date the edit workflow have
  // no aiContent. Force the user to re-generate before editing.
  if (!application.aiContent) {
    return (
      <LegacyApplicationBanner
        applicationId={application.id}
        jobId={application.jobId}
        jobTitle={application.job?.title ?? application.role ?? "Untitled"}
        company={application.job?.company ?? application.company ?? ""}
        resumePdfUrl={application.resumePdfUrl}
      />
    );
  }

  const parsed = aiContentSchema.safeParse(application.aiContent);
  if (!parsed.success) {
    return (
      <LegacyApplicationBanner
        applicationId={application.id}
        jobId={application.jobId}
        jobTitle={application.job?.title ?? application.role ?? "Untitled"}
        company={application.job?.company ?? application.company ?? ""}
        resumePdfUrl={application.resumePdfUrl}
        invalidShape
      />
    );
  }

  const jobTitle = application.job?.title ?? application.role ?? "Untitled";
  // Built here, from the same helper the finalize/preview routes use, so the
  // in-page Download button cannot drift from the server's Content-Disposition.
  const candidateName = toStringValue(
    asRecord(application.resumeProfile?.basics).fullName,
  );

  return (
    <TailorClient
      applicationId={application.id}
      initialStatus={application.status}
      initialAiContent={parsed.data}
      initialAiContentHash={application.aiContentHash}
      resumePdfUrl={application.resumePdfUrl}
      coverPdfUrl={application.coverPdfUrl}
      resumePdfName={buildPdfFilename(candidateName, jobTitle, "cv")}
      coverPdfName={buildPdfFilename(candidateName, jobTitle, "cl")}
      job={{
        id: application.job?.id ?? null,
        title: jobTitle,
        company: application.job?.company ?? application.company ?? null,
        location: application.job?.location ?? null,
        market: application.job?.market ?? "AU",
      }}
    />
  );
}
