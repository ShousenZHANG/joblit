import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { renderResumeCNTex } from "@/lib/server/latex/renderResumeCN";
import { LatexRenderError, compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import type { CompileFile } from "@/lib/server/latex/compilePdf";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { mapResumeProfileCN } from "@/lib/server/latex/mapResumeProfileCN";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";

export const runtime = "nodejs";

const ResumeBasicsSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(3).max(40),
  location: z.string().trim().min(1).max(120).optional().nullable(),
  photoUrl: z.string().trim().url().max(500).optional().nullable(),
  gender: z.string().trim().max(10).optional().nullable(),
  age: z.string().trim().max(20).optional().nullable(),
  identity: z.string().trim().max(60).optional().nullable(),
  wechat: z.string().trim().max(60).optional().nullable(),
  qq: z.string().trim().max(20).optional().nullable(),
  availabilityMonth: z
    .union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.literal("")])
    .optional()
    .nullable(),
});

const ResumeLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(300),
});

const ResumeExperienceSchema = z.object({
  location: z.string().trim().min(1).max(120),
  dates: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(120),
  links: z.array(ResumeLinkSchema).max(2).optional().nullable(),
  bullets: z.array(z.string().trim().min(1).max(220)).max(12),
});

const ResumeProjectSchema = z.object({
  name: z.string().trim().min(1).max(140),
  location: z.string().trim().min(1).max(120).optional().nullable(),
  stack: z.string().trim().max(300).optional().nullable(),
  dates: z.string().trim().min(1).max(80),
  links: z.array(ResumeLinkSchema).max(4).optional().nullable(),
  bullets: z.array(z.string().trim().min(1).max(220)).max(12),
});

const ResumeEducationSchema = z.object({
  school: z.string().trim().min(1).max(140),
  degree: z.string().trim().min(1).max(140),
  location: z.string().trim().min(1).max(120).optional().nullable(),
  dates: z.string().trim().min(1).max(80),
  details: z.string().trim().max(200).optional().nullable(),
});

const ResumeSkillSchema = z.object({
  category: z.string().trim().min(1).max(60),
  items: z.array(z.string().trim().min(1).max(60)).max(30),
});

const ResumeProfileSchema = z.object({
  locale: z.string().optional().nullable(),
  basics: ResumeBasicsSchema.optional().nullable(),
  links: z.array(ResumeLinkSchema).max(8).optional().nullable(),
  summary: z.string().trim().min(1).max(2000).optional().nullable(),
  skills: z.array(ResumeSkillSchema).max(12).optional().nullable(),
  experiences: z.array(ResumeExperienceSchema).max(20).optional().nullable(),
  projects: z.array(ResumeProjectSchema).max(20).optional().nullable(),
  education: z.array(ResumeEducationSchema).max(10).optional().nullable(),
});

export async function POST(req: Request) {
  const requestId = randomUUID();
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" }, requestId },
      { status: 401 },
    );
  }

  const json = await req.json().catch(() => null);
  let sourceProfile: unknown = null;
  if (json && Object.keys(json as Record<string, unknown>).length > 0) {
    const parsed = ResumeProfileSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Invalid request body",
            details: parsed.error.flatten(),
          },
          requestId,
        },
        { status: 400 },
      );
    }
    sourceProfile = parsed.data;
  }

  if (!sourceProfile) {
    const { searchParams } = new URL(req.url);
    const rawLocale = searchParams.get("locale") ?? "en-AU";
    const pdfLocale = rawLocale === "zh-CN" ? "zh-CN" : "en-AU";
    sourceProfile = await getResumeProfile(userId, { locale: pdfLocale });
  }

  if (!sourceProfile) {
    return NextResponse.json(
      { error: { code: "NO_PROFILE", message: "Resume profile not found" }, requestId },
      { status: 404 },
    );
  }

  const profileRecord = sourceProfile as Record<string, unknown>;
  const locale = typeof profileRecord.locale === "string" ? profileRecord.locale : "en-AU";

  let tex: string;
  let candidateName: string;
  let candidateTitle: string;
  const files: CompileFile[] = [];

  if (locale === "zh-CN") {
    const input = mapResumeProfileCN(sourceProfile);
    tex = renderResumeCNTex(input);
    candidateName = input.candidate.name;
    candidateTitle = input.candidate.title;

    // Download photo for LaTeX compilation
    const basics = (sourceProfile as Record<string, unknown>).basics as Record<string, unknown> | undefined;
    const photoUrl = typeof basics?.photoUrl === "string" ? basics.photoUrl.trim() : "";
    if (photoUrl) {
      try {
        const photoRes = await fetch(photoUrl, { signal: AbortSignal.timeout(5000) });
        if (photoRes.ok) {
          const buf = Buffer.from(await photoRes.arrayBuffer());
          const ct = photoRes.headers.get("content-type") ?? "";
          const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg";
          files.push({ name: `photo${ext}`, base64: buf.toString("base64") });
        }
      } catch { /* photo download failed — render without photo */ }
    }
  } else {
    const input = mapResumeProfile(sourceProfile);
    tex = renderResumeTex(input);
    candidateName = input.candidate.name;
    candidateTitle = input.candidate.title;
  }

  let pdf: Buffer;
  try {
    pdf = await compileLatexToPdf(
      tex,
      {
        files: files.length > 0 ? files : undefined,
        engine: locale === "zh-CN" ? "xelatex" : "pdflatex",
      }
    );
  } catch (err) {
    if (err instanceof LatexRenderError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
          requestId,
        },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: { code: "UNKNOWN_ERROR", message: "Unknown render error" }, requestId },
      { status: 500 },
    );
  }

  const filename = buildPdfFilename(candidateName, candidateTitle);

  const body = new Uint8Array(pdf);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename=\"${filename}\"`,
      "x-request-id": requestId,
    },
  });
}
