import { prisma } from "@/lib/server/prisma";
import { Prisma } from "@/lib/generated/prisma";
import {
  applicationPublicationRecord,
  buildApplicationPublicationRenderContext,
  rebaseApplicationPublicationForRenderContext,
  type ApplicationPublicationPersistence,
} from "@/lib/server/applications/applicationPublication";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";

const DEFAULT_PROFILE_BASE_NAME = "Custom Blank";
const MAX_PROFILE_NAME_LENGTH = 80;
const PROFILE_MUTATION_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 30_000,
} as const;
const CONSERVATIVE_APPLICATION_PUBLICATION_INVALIDATION = {
  status: "DRAFT",
  resumeContentHash: null,
  resumePublishedHash: null,
  coverContentHash: null,
  coverPublishedHash: null,
} satisfies ApplicationPublicationPersistence;
const PROFILE_CLONE_SELECT = {
  summary: true,
  basics: true,
  links: true,
  skills: true,
  experiences: true,
  projects: true,
  education: true,
} satisfies Prisma.ResumeProfileSelect;
const LINKED_APPLICATION_PUBLICATION_SELECT = {
  id: true,
  status: true,
  aiContent: true,
  aiContentHash: true,
  resumePdfUrl: true,
  coverPdfUrl: true,
  resumeContentHash: true,
  resumePublishedHash: true,
  coverContentHash: true,
  coverPublishedHash: true,
  job: {
    select: {
      title: true,
      company: true,
      market: true,
    },
  },
} satisfies Prisma.ApplicationSelect;

type ResumeProfileRecord = Prisma.ResumeProfileGetPayload<Record<string, never>>;
type LinkedApplicationPublicationRecord = Prisma.ApplicationGetPayload<{
  select: typeof LINKED_APPLICATION_PUBLICATION_SELECT;
}>;
type ApplicationPublicationPatch = ApplicationPublicationPersistence & {
  id: string;
};

type ResumeProfileInput = {
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
    location?: string | null;
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

type ResumeProfileSummary = {
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

async function ensureActivePointer(
  userId: string,
  locale: string,
  resumeProfileId: string,
  client: Pick<Prisma.TransactionClient, "activeResumeProfile"> | typeof prisma = prisma,
) {
  await client.activeResumeProfile.upsert({
    where: { userId_locale: { userId, locale } },
    update: { resumeProfileId },
    create: { userId, locale, resumeProfileId },
  });
}

async function invalidateLinkedApplicationPublications(
  client: Pick<Prisma.TransactionClient, "application">,
  userId: string,
  resumeProfileId: string,
) {
  await client.application.updateMany({
    where: { userId, resumeProfileId },
    data: CONSERVATIVE_APPLICATION_PUBLICATION_INVALIDATION,
  });
}

async function lockOwnedResumeProfileForDelete(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
  locale: string,
  resumeProfileId: string,
) {
  const [profile] = await client.$queryRaw<{ id: string }[]>`
    SELECT profile."id"
    FROM "ResumeProfile" AS profile
    WHERE profile."id" = ${resumeProfileId}::uuid
      AND profile."userId" = ${userId}::uuid
      AND profile."locale" = ${locale}
    FOR UPDATE OF profile
  `;
  return profile ?? null;
}

async function rebaseLinkedApplicationPublications(
  client: Pick<Prisma.TransactionClient, "application" | "$executeRaw">,
  input: {
    userId: string;
    resumeProfileId: string;
    previousProfile: ResumeProfileRecord;
    nextProfile: ResumeProfileRecord;
  },
) {
  const applications = await client.application.findMany({
    where: {
      userId: input.userId,
      resumeProfileId: input.resumeProfileId,
    },
    select: LINKED_APPLICATION_PUBLICATION_SELECT,
  });

  const patches: ApplicationPublicationPatch[] = [];
  for (const application of applications) {
    const persistence = rebaseLinkedApplicationPublication(
      application,
      input.previousProfile,
      input.nextProfile,
    );
    if (!publicationPersistenceChanged(application, persistence)) continue;
    patches.push({ id: application.id, ...persistence });
  }
  await persistApplicationPublicationPatches(client, input, patches);
}

async function persistApplicationPublicationPatches(
  client: Pick<Prisma.TransactionClient, "$executeRaw">,
  scope: { userId: string; resumeProfileId: string },
  patches: readonly ApplicationPublicationPatch[],
) {
  if (patches.length === 0) return;
  const updatedCount = await client.$executeRaw`
    UPDATE "Application" AS application
    SET
      "status" = patch."status"::"ApplicationStatus",
      "resumeContentHash" = patch."resumeContentHash",
      "resumePublishedHash" = patch."resumePublishedHash",
      "coverContentHash" = patch."coverContentHash",
      "coverPublishedHash" = patch."coverPublishedHash",
      "updatedAt" = CURRENT_TIMESTAMP
    FROM jsonb_to_recordset(${JSON.stringify(patches)}::jsonb) AS patch(
      "id" uuid,
      "status" text,
      "resumeContentHash" text,
      "resumePublishedHash" text,
      "coverContentHash" text,
      "coverPublishedHash" text
    )
    WHERE application."id" = patch."id"
      AND application."userId" = ${scope.userId}::uuid
      AND application."resumeProfileId" = ${scope.resumeProfileId}::uuid
  `;
  if (updatedCount !== patches.length) {
    throw new Error("APPLICATION_PUBLICATION_REBASE_CONFLICT");
  }
}

function rebaseLinkedApplicationPublication(
  application: LinkedApplicationPublicationRecord,
  previousProfile: ResumeProfileRecord,
  nextProfile: ResumeProfileRecord,
): ApplicationPublicationPersistence {
  const parsedAiContent = aiContentSchema.safeParse(application.aiContent);
  if (!application.job || !parsedAiContent.success) {
    return CONSERVATIVE_APPLICATION_PUBLICATION_INVALIDATION;
  }
  const previousRenderContext = buildApplicationPublicationRenderContext({
    profile: previousProfile,
    job: application.job,
  });
  const nextRenderContext = buildApplicationPublicationRenderContext({
    profile: nextProfile,
    job: application.job,
  });
  return rebaseApplicationPublicationForRenderContext({
    aiContent: parsedAiContent.data,
    record: applicationPublicationRecord(application),
    previousRenderContext,
    nextRenderContext,
  }).persistence;
}

function publicationPersistenceChanged(
  application: LinkedApplicationPublicationRecord,
  persistence: ApplicationPublicationPersistence,
) {
  return (
    application.status !== persistence.status ||
    application.resumeContentHash !== persistence.resumeContentHash ||
    application.resumePublishedHash !== persistence.resumePublishedHash ||
    application.coverContentHash !== persistence.coverContentHash ||
    application.coverPublishedHash !== persistence.coverPublishedHash
  );
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

/**
 * Resolve an explicitly requested profile, scoped to its owner and — when the
 * caller names one — its locale.
 *
 * The locale scope is load-bearing, not defensive tidiness. Resume profiles
 * are per-locale (`ActiveResumeProfile` is keyed on `userId + locale`), so a
 * write that names a profile from one locale while asking for another would
 * update that profile and then repoint the *target* locale's active pointer at
 * it — silently making the Chinese resume the active English one. The editor
 * could produce exactly that request while switching locales, and the result
 * outlived the session because it was persisted.
 */
async function getTargetProfile(
  userId: string,
  profileId?: string,
  locale?: string,
) {
  if (!profileId) return null;
  return prisma.resumeProfile.findFirst({
    where: { id: profileId, userId, ...(locale ? { locale } : {}) },
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
    // Deliberately NOT locale-scoped. An Application stores the exact profile
    // it was built from, and historical rows can legitimately pair a profile
    // with a market whose locale differs. Reading back what a document was
    // actually rendered from is correct; the locale guard belongs on writes
    // and on the active pointer, which is where cross-locale damage occurs.
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
  // Scoped: the pointer is keyed on locale, so activating a profile from a
  // different one would make that locale serve the wrong resume.
  const target = await getTargetProfile(userId, profileId, locale);
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

type DeleteResumeProfileResult =
  | { status: "deleted"; deletedProfileId: string; activeProfileId: string | null }
  | { status: "not_found" }
  | { status: "last_profile" };

export async function deleteResumeProfile(
  userId: string,
  locale: string,
  profileId: string,
): Promise<DeleteResumeProfileResult> {
  return prisma.$transaction(async (tx) => {
    const lockedProfile = await lockOwnedResumeProfileForDelete(
      tx,
      userId,
      locale,
      profileId,
    );
    if (!lockedProfile) {
      return { status: "not_found" };
    }

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

    await invalidateLinkedApplicationPublications(tx, userId, profileId);

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
    ? await getTargetProfile(userId, explicitProfileId, locale)
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

  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.resumeProfile.update({
        where: { id: target.id },
        data: {
          ...normalized,
          ...(options?.name === undefined ? {} : { name: normalizeProfileName(options.name) }),
          revision: {
            increment: 1,
          },
        },
      });

      await rebaseLinkedApplicationPublications(tx, {
        userId,
        resumeProfileId: updated.id,
        previousProfile: target,
        nextProfile: updated,
      });

      if (options?.setActive !== false) {
        await ensureActivePointer(userId, locale, updated.id, tx);
      }

      return updated;
    },
    PROFILE_MUTATION_TRANSACTION_OPTIONS,
  );
}
