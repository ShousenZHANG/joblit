import { isDeepStrictEqual } from "node:util";

import type { Prisma } from "@/lib/generated/prisma";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
  type ApplicationPublicationRenderContext,
} from "@/lib/server/applications/applicationPublication";
import type { ApplicationDocumentTarget } from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

type RenderContextFenceInput = {
  userId: string;
  job: { id: string };
  resumeProfileId: string;
  publicationRenderContext: ApplicationPublicationRenderContext;
};

type LockedRenderSource = {
  profileSummary: string | null;
  profileBasics: unknown;
  profileLinks: unknown;
  profileSkills: unknown;
  profileExperiences: unknown;
  profileProjects: unknown;
  profileEducation: unknown;
  jobTitle: string;
  jobCompany: string | null;
  jobMarket: string;
};

/**
 * Re-read and lock every non-AI source that contributes to a rendered
 * Application document. A matching result stays protected until the caller's
 * transaction commits, so the PDF pointer cannot be advanced against a newer
 * Profile or Job revision.
 */
export async function applicationRenderContextMatchesCurrentSources(
  tx: Prisma.TransactionClient,
  input: RenderContextFenceInput,
  targets: readonly ApplicationDocumentTarget[],
): Promise<boolean> {
  return (
    (await fenceApplicationRenderContext(tx, input, targets)).kind === "matched"
  );
}

export type ApplicationRenderContextFence =
  | {
      kind: "matched";
      current: ApplicationPublicationRenderContext;
    }
  | { kind: "mismatched" };

/**
 * Lock the current sources, validate only the rendered targets, and return the
 * complete locked context. Callers must use `current` for aggregate projection
 * so an unrelated target cannot be resurrected from an older request snapshot.
 */
export async function fenceApplicationRenderContext(
  tx: Prisma.TransactionClient,
  input: RenderContextFenceInput,
  targets: readonly ApplicationDocumentTarget[],
): Promise<ApplicationRenderContextFence> {
  if (targets.length === 0) {
    return { kind: "matched", current: input.publicationRenderContext };
  }
  if (!input.publicationRenderContext.available) {
    return { kind: "mismatched" };
  }
  const [source] = await tx.$queryRaw<LockedRenderSource[]>`
    SELECT
      profile."summary" AS "profileSummary",
      profile."basics" AS "profileBasics",
      profile."links" AS "profileLinks",
      profile."skills" AS "profileSkills",
      profile."experiences" AS "profileExperiences",
      profile."projects" AS "profileProjects",
      profile."education" AS "profileEducation",
      job."title" AS "jobTitle",
      job."company" AS "jobCompany",
      job."market" AS "jobMarket"
    FROM "Job" AS job
    INNER JOIN "ResumeProfile" AS profile
      ON profile."id" = ${input.resumeProfileId}::uuid
      AND profile."userId" = ${input.userId}::uuid
    WHERE job."id" = ${input.job.id}::uuid
      AND job."userId" = ${input.userId}::uuid
    FOR SHARE OF job, profile
  `;
  if (!source) return { kind: "mismatched" };
  const current = buildApplicationPublicationRenderContext({
    profile: {
      summary: source.profileSummary,
      basics: source.profileBasics,
      links: source.profileLinks,
      skills: source.profileSkills,
      experiences: source.profileExperiences,
      projects: source.profileProjects,
      education: source.profileEducation,
    },
    job: {
      title: source.jobTitle,
      company: source.jobCompany,
      market: source.jobMarket,
    },
  });
  const matches = targets.every((target) =>
    isDeepStrictEqual(
      current[target],
      input.publicationRenderContext[target],
    ),
  );
  return matches
    ? { kind: "matched", current }
    : { kind: "mismatched" };
}

export function applicationPublicationTargets(
  aiContent: AiContent,
  renderContext: ApplicationPublicationRenderContext,
): ApplicationDocumentTarget[] {
  return (["resume", "cover"] as const).filter(
    (target) =>
      hashApplicationDocumentContent(aiContent, target, renderContext) !== null,
  );
}
