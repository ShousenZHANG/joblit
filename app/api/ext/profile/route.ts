import { NextResponse } from "next/server";
import {
  requireExtensionToken,
  ExtensionTokenError,
} from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const VALID_LOCALES = ["en-AU", "zh-CN"] as const;
type SupportedLocale = (typeof VALID_LOCALES)[number];

function parseLocale(raw: string | null): SupportedLocale {
  if (raw && (VALID_LOCALES as readonly string[]).includes(raw)) return raw as SupportedLocale;
  return "en-AU";
}

/** GET — Return the active ResumeProfile for the authenticated extension user. */
export async function GET(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);

    const locale = parseLocale(new URL(req.url).searchParams.get("locale"));

    // Find active profile for the locale
    const active = await prisma.activeResumeProfile.findUnique({
      where: { userId_locale: { userId, locale } },
      include: { resumeProfile: true },
    });

    if (!active) {
      // Fallback: latest profile for this locale
      const latest = await prisma.resumeProfile.findFirst({
        where: { userId, locale },
        orderBy: { updatedAt: "desc" },
      });

      if (!latest) {
        return NextResponse.json({ data: null });
      }

      return NextResponse.json({
        data: {
          id: latest.id,
          name: latest.name,
          locale: latest.locale,
          summary: latest.summary,
          basics: latest.basics,
          links: latest.links,
          skills: latest.skills,
          experiences: latest.experiences,
          projects: latest.projects,
          education: latest.education,
          updatedAt: latest.updatedAt,
        },
      });
    }

    const rp = active.resumeProfile;
    return NextResponse.json({
      data: {
        id: rp.id,
        name: rp.name,
        locale: rp.locale,
        summary: rp.summary,
        basics: rp.basics,
        links: rp.links,
        skills: rp.skills,
        experiences: rp.experiences,
        projects: rp.projects,
        education: rp.education,
        updatedAt: rp.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}
