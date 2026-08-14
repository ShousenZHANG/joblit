import { isDeepStrictEqual } from "node:util";

import type { Prisma } from "@/lib/generated/prisma";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
  type ApplicationPublicationRenderContext,
} from "@/lib/server/applications/applicationPublication";
import type { ApplicationDocumentTarget } from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { lockOwnedApplicationSources } from "./applicationSourceSnapshot";

type RenderContextFenceInput = {
  userId: string;
  job: { id: string };
  resumeProfileId: string;
  publicationRenderContext: ApplicationPublicationRenderContext;
};

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
  const source = await lockOwnedApplicationSources(tx, {
    userId: input.userId,
    jobId: input.job.id,
    resumeProfileId: input.resumeProfileId,
  });
  if (!source) return { kind: "mismatched" };
  const current = buildApplicationPublicationRenderContext({
    profile: {
      summary: source.profile.summary,
      basics: source.profile.basics,
      links: source.profile.links,
      skills: source.profile.skills,
      experiences: source.profile.experiences,
      projects: source.profile.projects,
      education: source.profile.education,
    },
    job: {
      title: source.job.title,
      company: source.job.company,
      market: source.job.market,
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
