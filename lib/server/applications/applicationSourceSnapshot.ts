import type { Prisma } from "@/lib/generated/prisma";

export const APPLICATION_SOURCE_PROFILE_SELECT = {
  id: true,
  userId: true,
  name: true,
  locale: true,
  summary: true,
  basics: true,
  links: true,
  skills: true,
  experiences: true,
  projects: true,
  education: true,
} satisfies Prisma.ResumeProfileSelect;

export const APPLICATION_SOURCE_JOB_SELECT = {
  id: true,
  userId: true,
  title: true,
  company: true,
  description: true,
  market: true,
} satisfies Prisma.JobSelect;

export type ApplicationSourceProfile = Prisma.ResumeProfileGetPayload<{
  select: typeof APPLICATION_SOURCE_PROFILE_SELECT;
}>;

export type ApplicationSourceJob = Prisma.JobGetPayload<{
  select: typeof APPLICATION_SOURCE_JOB_SELECT;
}>;

export type ApplicationSources = {
  profile: ApplicationSourceProfile | null;
  job: ApplicationSourceJob | null;
};

export type LockedApplicationSources = {
  profile: ApplicationSourceProfile;
  job: ApplicationSourceJob;
};

type LockedApplicationSourceRow = {
  profileId: string;
  profileUserId: string;
  profileName: string;
  profileLocale: string;
  profileSummary: string | null;
  profileBasics: Prisma.JsonValue;
  profileLinks: Prisma.JsonValue;
  profileSkills: Prisma.JsonValue;
  profileExperiences: Prisma.JsonValue;
  profileProjects: Prisma.JsonValue;
  profileEducation: Prisma.JsonValue;
  jobId: string;
  jobUserId: string;
  jobTitle: string;
  jobCompany: string | null;
  jobDescription: string | null;
  jobMarket: string;
};

export function ownedApplicationSources(
  input: {
    profile: ApplicationSourceProfile | null;
    job: ApplicationSourceJob | null;
  },
  userId: string,
): ApplicationSources {
  return {
    profile: input.profile?.userId === userId ? input.profile : null,
    job: input.job?.userId === userId ? input.job : null,
  };
}

/**
 * Read and share-lock every Profile/Job field used by Application rendering or
 * evidence review. Callers receive one owned, authoritative snapshot whose
 * source rows stay stable until their transaction commits. The caller must
 * already hold the corresponding JOBA; this row lock is always downstream of
 * the advisory-lock hierarchy.
 */
export async function lockOwnedApplicationSources(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    jobId: string;
    resumeProfileId: string;
  },
): Promise<LockedApplicationSources | null> {
  const [row] = await tx.$queryRaw<LockedApplicationSourceRow[]>`
    SELECT
      profile."id" AS "profileId",
      profile."userId" AS "profileUserId",
      profile."name" AS "profileName",
      profile."locale" AS "profileLocale",
      profile."summary" AS "profileSummary",
      profile."basics" AS "profileBasics",
      profile."links" AS "profileLinks",
      profile."skills" AS "profileSkills",
      profile."experiences" AS "profileExperiences",
      profile."projects" AS "profileProjects",
      profile."education" AS "profileEducation",
      job."id" AS "jobId",
      job."userId" AS "jobUserId",
      job."title" AS "jobTitle",
      job."company" AS "jobCompany",
      job."description" AS "jobDescription",
      job."market" AS "jobMarket"
    FROM "Job" AS job
    INNER JOIN "ResumeProfile" AS profile
      ON profile."id" = ${input.resumeProfileId}::uuid
      AND profile."userId" = ${input.userId}::uuid
    WHERE job."id" = ${input.jobId}::uuid
      AND job."userId" = ${input.userId}::uuid
    FOR SHARE OF job, profile
  `;
  if (!row) return null;
  return {
    profile: {
      id: row.profileId,
      userId: row.profileUserId,
      name: row.profileName,
      locale: row.profileLocale,
      summary: row.profileSummary,
      basics: row.profileBasics,
      links: row.profileLinks,
      skills: row.profileSkills,
      experiences: row.profileExperiences,
      projects: row.profileProjects,
      education: row.profileEducation,
    },
    job: {
      id: row.jobId,
      userId: row.jobUserId,
      title: row.jobTitle,
      company: row.jobCompany,
      description: row.jobDescription,
      market: row.jobMarket,
    },
  };
}
