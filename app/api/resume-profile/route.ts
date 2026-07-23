import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma";
import {
  createResumeProfile,
  deleteResumeProfile,
  getResumeProfile,
  listResumeProfiles,
  renameResumeProfile,
  setActiveResumeProfile,
  upsertResumeProfile,
} from "@/lib/server/resumeProfile";
import { ResumeProfileSchema } from "@/lib/shared/schemas/resumeProfile";

export const runtime = "nodejs";

const LocaleSchema = z.enum(["en-AU", "zh-CN"]).default("en-AU");

const ResumeProfileUpsertSchema = ResumeProfileSchema.extend({
  profileId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  setActive: z.boolean().optional(),
  locale: LocaleSchema,
});

const ResumeProfilePatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(80).optional(),
    mode: z.enum(["copy", "blank"]).optional(),
    sourceProfileId: z.string().uuid().optional(),
    locale: LocaleSchema,
  }),
  z.object({
    action: z.literal("activate"),
    profileId: z.string().uuid(),
    locale: LocaleSchema,
  }),
  z.object({
    action: z.literal("rename"),
    profileId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("delete"),
    profileId: z.string().uuid(),
    locale: LocaleSchema,
  }),
]);

async function buildResumeProfileResponse(userId: string, locale: string = "en-AU") {
  const { profiles, activeProfileId } = await listResumeProfiles(userId, locale);
  const activeProfile = activeProfileId
    ? await getResumeProfile(userId, { profileId: activeProfileId, locale })
    : null;

  return {
    profiles,
    activeProfileId,
    activeProfile,
    profile: activeProfile,
  };
}

function parsePrismaError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  if (error.code === "P2002" && String(error.meta?.target ?? "").includes("userId")) {
    return errorJson("MIGRATION_REQUIRED", "Database schema is outdated. Run `npx prisma migrate deploy` to remove ResumeProfile.userId uniqueness.", 409);
  }

  return null;
}

export async function GET(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const { searchParams } = new URL(req.url);
    const rawLocale = searchParams.get("locale") ?? "en-AU";
    const locale = rawLocale === "zh-CN" ? "zh-CN" : "en-AU";

    const state = await buildResumeProfileResponse(userId, locale);
    return NextResponse.json(state, { status: 200 });
  });
}

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const json = await req.json().catch(() => null);
    const parsed = ResumeProfileUpsertSchema.safeParse(json);
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    let profile;
    try {
      profile = await upsertResumeProfile(
        userId,
        {
          summary: parsed.data.summary,
          basics: parsed.data.basics,
          links: parsed.data.links,
          skills: parsed.data.skills,
          experiences: parsed.data.experiences,
          projects: parsed.data.projects,
          education: parsed.data.education,
        },
        {
          profileId: parsed.data.profileId,
          name: parsed.data.name,
          setActive: parsed.data.setActive,
          locale: parsed.data.locale,
        },
      );
    } catch (error) {
      const prismaErrorResponse = parsePrismaError(error);
      if (prismaErrorResponse) return prismaErrorResponse;
      throw error;
    }

    if (!profile) {
      return errorJson("PROFILE_NOT_FOUND", "Resume profile not found", 404);
    }

    const state = await buildResumeProfileResponse(userId, parsed.data.locale);
    return NextResponse.json(state, { status: 200 });
  });
}

export async function PATCH(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const json = await req.json().catch(() => null);
    const parsed = ResumeProfilePatchSchema.safeParse(json);
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    let locale = "en-AU";

    if (parsed.data.action === "create") {
      locale = parsed.data.locale;
      try {
        await createResumeProfile(userId, {
          name: parsed.data.name,
          setActive: true,
          mode: parsed.data.mode,
          sourceProfileId: parsed.data.sourceProfileId,
          locale,
        });
      } catch (error) {
        const prismaErrorResponse = parsePrismaError(error);
        if (prismaErrorResponse) return prismaErrorResponse;
        throw error;
      }
    }

    if (parsed.data.action === "activate") {
      locale = parsed.data.locale;
      const target = await setActiveResumeProfile(userId, locale, parsed.data.profileId);
      if (!target) {
        return errorJson("PROFILE_NOT_FOUND", "Resume profile not found", 404);
      }
    }

    if (parsed.data.action === "rename") {
      const target = await renameResumeProfile(userId, parsed.data.profileId, parsed.data.name);
      if (!target) {
        return errorJson("PROFILE_NOT_FOUND", "Resume profile not found", 404);
      }
    }

    if (parsed.data.action === "delete") {
      locale = parsed.data.locale;
      const result = await deleteResumeProfile(userId, locale, parsed.data.profileId);
      if (result.status === "not_found") {
        return errorJson("PROFILE_NOT_FOUND", "Resume profile not found", 404);
      }
      if (result.status === "last_profile") {
        return errorJson("LAST_PROFILE", "At least one resume version is required.", 409);
      }
    }

    const state = await buildResumeProfileResponse(userId, locale);
    return NextResponse.json(state, { status: 200 });
  });
}
