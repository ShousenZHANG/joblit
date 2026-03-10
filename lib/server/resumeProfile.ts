import { prisma } from "@/lib/server/prisma";
import { Prisma } from "@/lib/generated/prisma";

const DEFAULT_PROFILE_BASE_NAME = "Custom Blank";
const MAX_PROFILE_NAME_LENGTH = 80;
const PROFILE_CLONE_SELECT = {
  summary: true,
  basics: true,
  links: true,
  skills: true,
  experiences: true,
  projects: true,
  education: true,
} satisfies Prisma.ResumeProfileSelect;

export type ResumeProfileInput = {
  summary?: string | null;
  basics?: {
    fullName: string;
    title: string;
    email: string;
    phone: string;
    location?: string | null;
    // CN-specific optional fields
    photoUrl?: string | null;
    gender?: string | null;
    age?: string | null;
    identity?: string | null;
    availabilityMonth?: string | null;
  } | null;
  links?: {
    label: string;
    url: string;
  }[] | null;
  skills?: {
    category: string;
    items: string[];
  }[] | null;
  experiences?: {
    location: string;
    dates: string;
    title: string;
    company: string;
    links?: {
      label: string;
      url: string;
    }[] | null;
    bullets: string[];
  }[] | null;
  projects?: {
    name: string;
    location?: string | null;
    dates: string;
    stack?: string | null;
    links?: {
      label: string;
      url: string;
    }[] | null;
    bullets: string[];
  }[] | null;
  education?: {
    school: string;
    degree: string;
    location?: string | null;
    dates: string;
    details?: string | null;
  }[] | null;
};

export type ResumeProfileSummary = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
  isActive: boolean;
};

function toJsonValue<T>(value: T | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value;
}

function toNormalizedWriteData(data: ResumeProfileInput) {
  return {
    summary: data.summary === undefined ? undefined : data.summary,
    basics: toJsonValue(data.basics),
    links: toJsonValue(data.links),
    skills: toJsonValue(data.skills),
    experiences: toJsonValue(data.experiences),
    projects: toJsonValue(data.projects),
    education: toJsonValue(data.education),
  } satisfies Prisma.ResumeProfileUpdateInput;
}

function normalizeProfileName(name?: string | null) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return DEFAULT_PROFILE_BASE_NAME;
  if (trimmed.length <= MAX_PROFILE_NAME_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_PROFILE_NAME_LENGTH);
}

function cloneJsonValueForCreate(value: Prisma.JsonValue | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

async function ensureActivePointer(userId: string, locale: string, resumeProfileId: string) {
  await prisma.activeResumeProfile.upsert({
    where: { userId_locale: { userId, locale } },
    update: { resumeProfileId },
    create: { userId, locale, resumeProfileId },
  });
}

async function getFallbackLatestProfile(userId: string, locale: string) {
  const latest = await prisma.resumeProfile.findFirst({
    where: { userId, locale },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (latest) {
    await ensureActivePointer(userId, locale, latest.id);
  }
  return latest;
}

async function getTargetProfile(userId: string, profileId?: string) {
  if (!profileId) return null;
  return prisma.resumeProfile.findFirst({
    where: { id: profileId, userId },
  });
}

export async function listResumeProfiles(userId: string, locale: string = "en-AU") {
  const [profiles, activePointer] = await prisma.$transaction([
    prisma.resumeProfile.findMany({
      where: { userId, locale },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        revision: true,
      },
    }),
    prisma.activeResumeProfile.findUnique({
      where: { userId_locale: { userId, locale } },
      select: { resumeProfileId: true },
    }),
  ]);

  let activeProfileId = activePointer?.resumeProfileId ?? null;
  if (!activeProfileId && profiles[0]) {
    activeProfileId = profiles[0].id;
    await ensureActivePointer(userId, locale, profiles[0].id);
  }

  return {
    activeProfileId,
    profiles: profiles.map((profile) => ({
      ...profile,
      isActive: profile.id === activeProfileId,
    })) satisfies ResumeProfileSummary[],
  };
}

export async function getResumeProfile(userId: string, options?: { profileId?: string; locale?: string }) {
  const locale = options?.locale ?? "en-AU";
  const explicitProfileId = options?.profileId;
  if (explicitProfileId) {
    return getTargetProfile(userId, explicitProfileId);
  }

  const activePointer = await prisma.activeResumeProfile.findUnique({
    where: { userId_locale: { userId, locale } },
    select: { resumeProfileId: true },
  });

  if (activePointer?.resumeProfileId) {
    const active = await prisma.resumeProfile.findFirst({
      where: {
        id: activePointer.resumeProfileId,
        userId,
      },
    });
    if (active) return active;
  }

  return getFallbackLatestProfile(userId, locale);
}

export async function setActiveResumeProfile(userId: string, locale: string, profileId: string) {
  const target = await getTargetProfile(userId, profileId);
  if (!target) return null;
  await ensureActivePointer(userId, locale, target.id);
  return target;
}

async function buildDefaultProfileName(
  userId: string,
  locale: string,
  tx: Pick<Prisma.TransactionClient, "resumeProfile"> | typeof prisma = prisma,
) {
  const existing = await tx.resumeProfile.findMany({
    where: { userId, locale },
    select: { name: true },
  });

  const usedNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
  if (!usedNames.has(DEFAULT_PROFILE_BASE_NAME.toLowerCase())) {
    return DEFAULT_PROFILE_BASE_NAME;
  }

  let suffix = 2;
  while (usedNames.has(`${DEFAULT_PROFILE_BASE_NAME} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${DEFAULT_PROFILE_BASE_NAME} ${suffix}`;
}

export async function createResumeProfile(
  userId: string,
  options?: {
    name?: string;
    setActive?: boolean;
    mode?: "copy" | "blank";
    sourceProfileId?: string;
    locale?: string;
  },
) {
  const locale = options?.locale ?? "en-AU";
  const createMode = options?.mode ?? "copy";

  return prisma.$transaction(async (tx) => {
    const resolvedName = options?.name
      ? normalizeProfileName(options.name)
      : await buildDefaultProfileName(userId, locale, tx);

    let sourceProfile: Prisma.ResumeProfileGetPayload<{ select: typeof PROFILE_CLONE_SELECT }> | null =
      null;

    if (createMode === "copy") {
      if (options?.sourceProfileId) {
        sourceProfile = await tx.resumeProfile.findFirst({
          where: { id: options.sourceProfileId, userId },
          select: PROFILE_CLONE_SELECT,
        });
      }

      if (!sourceProfile) {
        const activePointer = await tx.activeResumeProfile.findUnique({
          where: { userId_locale: { userId, locale } },
          select: { resumeProfileId: true },
        });
        if (activePointer?.resumeProfileId) {
          sourceProfile = await tx.resumeProfile.findFirst({
            where: { id: activePointer.resumeProfileId, userId },
            select: PROFILE_CLONE_SELECT,
          });
        }
      }

      if (!sourceProfile) {
        sourceProfile = await tx.resumeProfile.findFirst({
          where: { userId, locale },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          select: PROFILE_CLONE_SELECT,
        });
      }
    }

    const profile = await tx.resumeProfile.create({
      data: {
        userId,
        name: resolvedName,
        locale,
        ...(sourceProfile
          ? {
              summary: sourceProfile.summary,
              basics: cloneJsonValueForCreate(sourceProfile.basics),
              links: cloneJsonValueForCreate(sourceProfile.links),
              skills: cloneJsonValueForCreate(sourceProfile.skills),
              experiences: cloneJsonValueForCreate(sourceProfile.experiences),
              projects: cloneJsonValueForCreate(sourceProfile.projects),
              education: cloneJsonValueForCreate(sourceProfile.education),
            }
          : {}),
      },
    });

    if (options?.setActive !== false) {
      await tx.activeResumeProfile.upsert({
        where: { userId_locale: { userId, locale } },
        update: { resumeProfileId: profile.id },
        create: { userId, locale, resumeProfileId: profile.id },
      });
    }

    return profile;
  });
}

export async function renameResumeProfile(userId: string, profileId: string, name: string) {
  const target = await getTargetProfile(userId, profileId);
  if (!target) return null;

  return prisma.resumeProfile.update({
    where: { id: target.id },
    data: {
      name: normalizeProfileName(name),
    },
  });
}

export type DeleteResumeProfileResult =
  | { status: "deleted"; deletedProfileId: string; activeProfileId: string | null }
  | { status: "not_found" }
  | { status: "last_profile" };

export async function deleteResumeProfile(
  userId: string,
  locale: string,
  profileId: string,
): Promise<DeleteResumeProfileResult> {
  return prisma.$transaction(async (tx) => {
    const profiles = await tx.resumeProfile.findMany({
      where: { userId, locale },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });

    const target = profiles.find((profile) => profile.id === profileId);
    if (!target) {
      return { status: "not_found" };
    }

    if (profiles.length <= 1) {
      return { status: "last_profile" };
    }

    const activePointer = await tx.activeResumeProfile.findUnique({
      where: { userId_locale: { userId, locale } },
      select: { resumeProfileId: true },
    });

    await tx.resumeProfile.delete({
      where: { id: profileId },
    });

    let nextActiveProfileId = activePointer?.resumeProfileId ?? null;
    if (!nextActiveProfileId || nextActiveProfileId === profileId) {
      nextActiveProfileId = profiles.find((profile) => profile.id !== profileId)?.id ?? null;
      if (nextActiveProfileId) {
        await tx.activeResumeProfile.upsert({
          where: { userId_locale: { userId, locale } },
          update: { resumeProfileId: nextActiveProfileId },
          create: { userId, locale, resumeProfileId: nextActiveProfileId },
        });
      }
    }

    return {
      status: "deleted",
      deletedProfileId: profileId,
      activeProfileId: nextActiveProfileId,
    };
  });
}

export async function upsertResumeProfile(
  userId: string,
  data: ResumeProfileInput,
  options?: {
    profileId?: string;
    name?: string;
    setActive?: boolean;
    locale?: string;
  },
) {
  const locale = options?.locale ?? "en-AU";
  const normalized = toNormalizedWriteData(data);
  const explicitProfileId = options?.profileId;

  const target = explicitProfileId
    ? await getTargetProfile(userId, explicitProfileId)
    : await getResumeProfile(userId, { locale });

  if (explicitProfileId && !target) {
    return null;
  }

  if (!target) {
    const created = await prisma.resumeProfile.create({
      data: {
        userId,
        locale,
        name: normalizeProfileName(options?.name),
        ...normalized,
      },
    });

    if (options?.setActive !== false) {
      await ensureActivePointer(userId, locale, created.id);
    }

    return created;
  }

  const updated = await prisma.resumeProfile.update({
    where: { id: target.id },
    data: {
      ...normalized,
      ...(options?.name === undefined ? {} : { name: normalizeProfileName(options.name) }),
      revision: {
        increment: 1,
      },
    },
  });

  if (options?.setActive !== false) {
    await ensureActivePointer(userId, locale, updated.id);
  }

  return updated;
}
