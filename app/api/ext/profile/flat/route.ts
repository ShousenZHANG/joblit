import { NextResponse } from "next/server";
import {
  requireExtensionToken,
  ExtensionTokenError,
} from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";
import { flattenProfile } from "@/lib/server/extensionProfile";
import type { ResumeProfile } from "@/lib/shared/schemas/resumeProfile";

export const runtime = "nodejs";

const VALID_LOCALES = ["en-AU", "zh-CN"] as const;
type SupportedLocale = (typeof VALID_LOCALES)[number];

function parseLocale(raw: string | null): SupportedLocale {
  if (raw && (VALID_LOCALES as readonly string[]).includes(raw)) return raw as SupportedLocale;
  return "en-AU";
}

/** GET — Return a flattened key-value map of the user's profile for form filling. */
export async function GET(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);

    const locale = parseLocale(new URL(req.url).searchParams.get("locale"));

    const active = await prisma.activeResumeProfile.findUnique({
      where: { userId_locale: { userId, locale } },
      include: { resumeProfile: true },
    });

    const rp = active?.resumeProfile
      ?? await prisma.resumeProfile.findFirst({
           where: { userId, locale },
           orderBy: { updatedAt: "desc" },
         });

    if (!rp) {
      return NextResponse.json({ data: null });
    }

    const profileData: ResumeProfile = {
      locale: rp.locale,
      summary: rp.summary,
      basics: rp.basics as ResumeProfile["basics"],
      links: rp.links as ResumeProfile["links"],
      skills: rp.skills as ResumeProfile["skills"],
      experiences: rp.experiences as ResumeProfile["experiences"],
      projects: rp.projects as ResumeProfile["projects"],
      education: rp.education as ResumeProfile["education"],
    };

    return NextResponse.json({
      data: {
        profileId: rp.id,
        profileName: rp.name,
        locale: rp.locale,
        flat: flattenProfile(profileData),
        updatedAt: rp.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}
