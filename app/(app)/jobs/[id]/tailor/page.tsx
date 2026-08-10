import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { loadApplicationReviewSnapshot } from "@/lib/server/applications/applicationReviewSnapshot";
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
  const result = await loadApplicationReviewSnapshot({
    userId,
    applicationId: id,
  });
  if (result.kind === "not_found" || result.kind === "busy") {
    redirect("/jobs");
  }
  if (result.kind === "legacy") {
    const legacy = result.application;
    return (
      <LegacyApplicationBanner
        applicationId={legacy.applicationId}
        jobId={legacy.jobId}
        jobTitle={legacy.jobTitle}
        company={legacy.company}
        resumePdfUrl={legacy.resumePdfUrl}
        invalidShape={legacy.invalidShape}
      />
    );
  }
  const snapshot = result.snapshot;

  return (
    <TailorClient
      applicationId={snapshot.applicationId}
      initialPublication={snapshot.publication}
      initialAiContent={snapshot.aiContent}
      initialAiContentHash={snapshot.aiContentHash}
      resumePdfUrl={snapshot.documents.resume.pdfUrl}
      coverPdfUrl={snapshot.documents.cover.pdfUrl}
      resumePdfName={snapshot.documents.resume.pdfName}
      coverPdfName={snapshot.documents.cover.pdfName}
      job={snapshot.job}
    />
  );
}
