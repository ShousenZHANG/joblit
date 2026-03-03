import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildResumePdfForJob } from "@/lib/server/applications/buildResumePdf";
import { LatexRenderError } from "@/lib/server/latex/compilePdf";
import { del, put } from "@vercel/blob";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";

export const runtime = "nodejs";

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const PatchSchema = z.object({
  status: z.enum(["NEW", "APPLIED", "REJECTED"]).optional(),
});

export async function PATCH(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const json = await _req.json().catch(() => null);
  const parsedBody = PatchSchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const job = await prisma.job.findFirst({
    where: { id: parsedParams.data.id, userId },
    select: {
      id: true,
      title: true,
      company: true,
      description: true,
      status: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (parsedBody.data.status) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: parsedBody.data.status },
    });
  }

  let resumeSaved = false;
  let resumePdfUrl: string | null = null;
  let resumePdfName: string | null = null;
  let saveError: { code: string; message: string } | null = null;

  if (parsedBody.data.status === "APPLIED") {
    const existingApplication = await prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId: job.id } },
      select: { resumePdfUrl: true, resumePdfName: true },
    });

    if (existingApplication?.resumePdfUrl && existingApplication?.resumePdfName) {
      resumeSaved = true;
      resumePdfUrl = existingApplication.resumePdfUrl;
      resumePdfName = existingApplication.resumePdfName;
      return NextResponse.json({
        ok: true,
        resumeSaved,
        resumePdfUrl,
        resumePdfName,
        saveError,
      });
    }

    const profile = await getResumeProfile(userId);
    if (!profile) {
      saveError = {
        code: "NO_PROFILE",
        message: "Create and save your master resume before generating.",
      };
    } else if (!process.env.BLOB_READ_WRITE_TOKEN) {
      saveError = {
        code: "BLOB_TOKEN_MISSING",
        message: "Storage is not configured for resume saving.",
      };
    } else {
      try {
        const pdfResult = await buildResumePdfForJob({ userId, profile, job });
        const mapped = mapResumeProfile(profile);
        const filename = buildPdfFilename(mapped.candidate.name, job.title);
        const blob = await put(
          buildApplicationArtifactBlobPath({
            userId,
            jobId: job.id,
            target: "resume",
          }),
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

        resumeSaved = true;
        resumePdfUrl = blob.url;
        resumePdfName = filename;
      } catch (err) {
        if (err instanceof LatexRenderError) {
          saveError = {
            code: err.code,
            message: err.message,
          };
        } else {
          saveError = {
            code: "RESUME_SAVE_FAILED",
            message: "Failed to save the applied resume.",
          };
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    resumeSaved,
    resumePdfUrl,
    resumePdfName,
    saveError,
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: parsedParams.data.id, userId },
    select: { id: true, description: true },
  });

  if (!job) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ id: job.id, description: job.description ?? null });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: parsedParams.data.id, userId },
    select: { id: true, jobUrl: true },
  });

  if (!job) {
    // Idempotent delete: if the row is already gone, treat it as success.
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  const application = await prisma.application.findUnique({
    where: { userId_jobId: { userId, jobId: job.id } },
    select: {
      resumeTexUrl: true,
      resumePdfUrl: true,
      coverTexUrl: true,
      coverPdfUrl: true,
    },
  });

  const canonicalJobUrl = canonicalizeJobUrl(job.jobUrl);
  await prisma.$transaction([
    prisma.deletedJobUrl.upsert({
      where: { userId_jobUrl: { userId, jobUrl: canonicalJobUrl } },
      update: {},
      create: { userId, jobUrl: canonicalJobUrl },
    }),
    prisma.application.deleteMany({
      where: {
        userId,
        jobId: job.id,
      },
    }),
    prisma.job.delete({ where: { id: job.id } }),
  ]);

  const artifactUrls = Array.from(
    new Set(
      [
        application?.resumeTexUrl,
        application?.resumePdfUrl,
        application?.coverTexUrl,
        application?.coverPdfUrl,
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );

  let blobCleanupFailed = 0;
  let blobCleanupDeleted = 0;
  if (process.env.BLOB_READ_WRITE_TOKEN && artifactUrls.length > 0) {
    const cleanup = await Promise.allSettled(
      artifactUrls.map((url) => del(url, { token: process.env.BLOB_READ_WRITE_TOKEN })),
    );
    blobCleanupDeleted = cleanup.filter((result) => result.status === "fulfilled").length;
    blobCleanupFailed = cleanup.length - blobCleanupDeleted;
  }

  return NextResponse.json({
    ok: true,
    blobCleanup: {
      attempted: artifactUrls.length,
      deleted: blobCleanupDeleted,
      failed: blobCleanupFailed,
    },
  });
}
