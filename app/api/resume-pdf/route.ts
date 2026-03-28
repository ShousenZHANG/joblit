import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { renderResumeCNTex } from "@/lib/server/latex/renderResumeCN";
import { LatexRenderError, compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import type { CompileFile } from "@/lib/server/latex/compilePdf";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { mapResumeProfileCN } from "@/lib/server/latex/mapResumeProfileCN";
import { buildPdfFilename } from "@/lib/server/files/pdfFilename";
import { ResumeProfileSchema } from "@/lib/shared/schemas/resumeProfile";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

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
