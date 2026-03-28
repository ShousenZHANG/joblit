import { put } from "@vercel/blob";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { LatexRenderError } from "@/lib/server/latex/compilePdf";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";

export type JobStatusUpdateResult = {
  ok: true;
  resumeSaved: boolean;
  resumePdfUrl: string | null;
  resumePdfName: string | null;
  saveError: { code: string; message: string } | null;
};

type JobRow = {
  id: string;
  title: string;
  company: string | null;
  description: string | null;
  status: string;
};

export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: "NEW" | "APPLIED" | "REJECTED" | undefined,
): Promise<JobStatusUpdateResult | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true, title: true, company: true, description: true, status: true },
  });

  if (!job) return null;

  if (newStatus) {
    await prisma.job.update({ where: { id: job.id }, data: { status: newStatus } });
  }

  if (newStatus !== "APPLIED") {
    return { ok: true, resumeSaved: false, resumePdfUrl: null, resumePdfName: null, saveError: null };
  }

  return applyToJob(userId, job);
}

async function applyToJob(userId: string, job: JobRow): Promise<JobStatusUpdateResult> {
  const existingApplication = await prisma.application.findUnique({
    where: { userId_jobId: { userId, jobId: job.id } },
    select: { resumePdfUrl: true, resumePdfName: true },
  });

  if (existingApplication?.resumePdfUrl && existingApplication?.resumePdfName) {
    return {
      ok: true,
      resumeSaved: true,
      resumePdfUrl: existingApplication.resumePdfUrl,
      resumePdfName: existingApplication.resumePdfName,
      saveError: null,
    };
  }

  const profile = await getResumeProfile(userId);
  if (!profile) {
    return {
      ok: true,
      resumeSaved: false,
      resumePdfUrl: null,
      resumePdfName: null,
      saveError: { code: "NO_PROFILE", message: "Create and save your master resume before generating." },
    };
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      ok: true,
      resumeSaved: false,
      resumePdfUrl: null,
      resumePdfName: null,
      saveError: { code: "BLOB_TOKEN_MISSING", message: "Storage is not configured for resume saving." },
    };
  }

  try {
    const pdfResult = await buildResumePdfForJob({ userId, profile, job });
    const mapped = mapResumeProfile(profile);
    const filename = buildPdfFilename(mapped.candidate.name, job.title);
    const blob = await put(
      buildApplicationArtifactBlobPath({ userId, jobId: job.id, target: "resume" }),
      pdfResult.pdf,
      {
        access: "public",
        contentType: "application/pdf",
        token: process.env.BLOB_READ_WRITE_TOKEN,
        ...APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
      },
    );

    await prisma.application.upsert({
      where: { userId_jobId: { userId, jobId: job.id } },
      create: {
        userId,
        jobId: job.id,
        resumeProfileId: profile.id,
        company: job.company,
        role: job.title,
        resumePdfUrl: blob.url,
        resumePdfName: filename,
      },
      update: {
        resumeProfileId: profile.id,
        company: job.company,
        role: job.title,
        resumePdfUrl: blob.url,
        resumePdfName: filename,
      },
    });

    return { ok: true, resumeSaved: true, resumePdfUrl: blob.url, resumePdfName: filename, saveError: null };
  } catch (err) {
    const saveError =
      err instanceof LatexRenderError
        ? { code: err.code, message: err.message }
        : { code: "RESUME_SAVE_FAILED", message: "Failed to save the applied resume." };
    return { ok: true, resumeSaved: false, resumePdfUrl: null, resumePdfName: null, saveError };
  }
}
