import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { renderResumeCNTex } from "@/lib/server/latex/renderResumeCN";
import { LatexRenderError, compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import type { CompileFile } from "@/lib/server/latex/compilePdf";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { mapResumeProfileCN } from "@/lib/server/latex/mapResumeProfileCN";
import {
  buildPdfFilename,
  contentDispositionAttachment,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import { ResumeProfileSchema } from "@/lib/shared/schemas/resumeProfile";
import {
  buildResumePhotoCompileFile,
  parseTrustedResumePhotoUrl,
} from "@/lib/server/resumePhotoBlob";
import { safeOutboundFetch } from "@/lib/server/net/safeFetch";

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

  // LaTeX compilation is the most expensive request this app serves — cap it
  // per user so one runaway client can't monopolise the render service.
  const rl = checkRateLimit(`resume-pdf:${userId}`, { limit: 10, windowSeconds: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: { code: "RATE_LIMITED", message: "Too many PDF renders — try again shortly." },
        requestId,
      },
      { status: 429, headers: rateLimitHeaders(rl) },
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
  const files: CompileFile[] = [];

  if (locale === "zh-CN") {
    const input = mapResumeProfileCN(sourceProfile);
    tex = renderResumeCNTex(input);

    // Only fetch photos uploaded through this user's Vercel Blob path.
    const basics = (sourceProfile as Record<string, unknown>).basics as Record<string, unknown> | undefined;
    const photoUrl = typeof basics?.photoUrl === "string" ? basics.photoUrl.trim() : "";
    const trustedPhotoUrl = photoUrl ? parseTrustedResumePhotoUrl(photoUrl, userId) : null;
    if (trustedPhotoUrl) {
      try {
        const photoRes = await safeOutboundFetch(
          trustedPhotoUrl,
          {},
          {
            allowedHosts: ["public.blob.vercel-storage.com"],
            allowSubdomains: true,
            maxRedirects: 0,
            maxResponseBytes: 2 * 1024 * 1024,
            timeoutMs: 5_000,
          },
        );
        if (photoRes.ok) {
          const photoFile = await buildResumePhotoCompileFile(photoRes);
          if (photoFile) files.push(photoFile);
        }
      } catch {
        // Photo fetch is best-effort; render the resume without it on failure.
      }
    }
  } else {
    const input = mapResumeProfile(sourceProfile);
    tex = renderResumeTex(input);
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

  // No job is attached here — this is the user's master resume — so the title
  // segment is their own profile headline, not a job title.
  const { name, title } = resumeFilenameSegments(sourceProfile);
  const filename = buildPdfFilename(name, title);

  const body = new Uint8Array(pdf);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDispositionAttachment(filename),
      "x-request-id": requestId,
    },
  });
}
