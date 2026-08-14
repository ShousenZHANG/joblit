import { isDeepStrictEqual } from "node:util";

import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import {
  aiContentSchema,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { evolveApplicationAiContent } from "./applicationAiContentAggregate";
import { acquireApplicationMutationLock } from "./applicationMutationLock";
import {
  buildApplicationPublicationRenderContext,
  transitionApplicationPublication,
  UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT,
} from "./applicationPublication";
import {
  APPLICATION_SOURCE_JOB_SELECT,
  APPLICATION_SOURCE_PROFILE_SELECT,
  lockOwnedApplicationSources,
  ownedApplicationSources,
  type ApplicationSources,
} from "./applicationSourceSnapshot";
import { persistReviewLedger } from "./persistReviewLedger";

const APPLICATION_EDIT_TRANSACTION_TIMEOUT_MS = 30_000;

const APPLICATION_EDIT_PREFLIGHT_SELECT = {
  id: true,
  jobId: true,
  resumeProfileId: true,
  aiContentHash: true,
  resumeProfile: { select: APPLICATION_SOURCE_PROFILE_SELECT },
  job: { select: APPLICATION_SOURCE_JOB_SELECT },
} satisfies Prisma.ApplicationSelect;

const LOCKED_APPLICATION_EDIT_SELECT = {
  id: true,
  jobId: true,
  resumeProfileId: true,
  aiContent: true,
  aiContentHash: true,
  status: true,
  resumePdfUrl: true,
  coverPdfUrl: true,
  resumeContentHash: true,
  coverContentHash: true,
  resumePublishedHash: true,
  coverPublishedHash: true,
} satisfies Prisma.ApplicationSelect;

type ApplicationEditPreflight = Prisma.ApplicationGetPayload<{
  select: typeof APPLICATION_EDIT_PREFLIGHT_SELECT;
}>;

type LockedApplicationEdit = Prisma.ApplicationGetPayload<{
  select: typeof LOCKED_APPLICATION_EDIT_SELECT;
}>;

type ApplicationEditIdentity = {
  userId: string;
  applicationId: string;
  expectedHash: string | null;
};

export type ApplicationEditCommitted = {
  kind: "committed";
  aiContent: AiContent;
  aiContentHash: string;
  publication: ApplicationPublication;
};

export type ApplicationEditFailure =
  | { kind: "not_found" }
  | { kind: "stale_write"; currentHash?: string | null }
  | { kind: "invalid_ai_content" }
  | { kind: "canonical_evidence_unavailable" }
  | { kind: "stale_render_context" };

export type AutoSaveApplicationEditResult =
  | ApplicationEditCommitted
  | ApplicationEditFailure;

export type DiscardApplicationEditsResult =
  | ApplicationEditCommitted
  | ApplicationEditFailure
  | { kind: "no_ai_content" };

type ApplicationEditMutation =
  | { kind: "apply_client_edits"; submitted: AiContent }
  | { kind: "discard_edits" };

type ApplicationEditInput = ApplicationEditIdentity & {
  mutation: ApplicationEditMutation;
};

function preflightSources(
  application: ApplicationEditPreflight,
  userId: string,
): ApplicationSources {
  return ownedApplicationSources(
    { profile: application.resumeProfile, job: application.job },
    userId,
  );
}

async function loadApplicationEditPreflight(
  input: ApplicationEditIdentity,
): Promise<ApplicationEditPreflight | null> {
  return prisma.application.findFirst({
    where: { id: input.applicationId, userId: input.userId },
    select: APPLICATION_EDIT_PREFLIGHT_SELECT,
  });
}

async function loadLockedApplicationEdit(
  tx: Prisma.TransactionClient,
  input: ApplicationEditIdentity,
): Promise<LockedApplicationEdit | null> {
  return tx.application.findFirst({
    where: { id: input.applicationId, userId: input.userId },
    select: LOCKED_APPLICATION_EDIT_SELECT,
  });
}

async function lockCurrentApplicationEditSources(
  tx: Prisma.TransactionClient,
  input: ApplicationEditIdentity,
  application: LockedApplicationEdit,
  expected: ApplicationSources,
): Promise<ApplicationSources | null> {
  if (!expected.profile || !expected.job) return expected;
  if (!application.resumeProfileId || !application.jobId) return null;

  const current = await lockOwnedApplicationSources(tx, {
    userId: input.userId,
    jobId: application.jobId,
    resumeProfileId: application.resumeProfileId,
  });
  if (!current) return null;
  return isDeepStrictEqual(current, expected) ? current : null;
}

function reviewContext(
  sources: ApplicationSources,
  userId: string,
) {
  if (!sources.profile) return undefined;
  return {
    scopeKey: userId,
    resumeSnapshot: {
      profile: sources.profile,
      renderInput: mapResumeProfile(sources.profile),
    },
    jobDescription: sources.job?.description,
    jobSourceAvailable: Boolean(sources.job),
  };
}

function publicationRenderContext(sources: ApplicationSources) {
  return sources.profile && sources.job
    ? buildApplicationPublicationRenderContext({
        profile: sources.profile,
        job: {
          title: sources.job.title,
          company: sources.job.company,
          market: sources.job.market,
        },
      })
    : UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT;
}

function applicationEditMutationResult(
  current: AiContent,
  mutation: ApplicationEditMutation,
  sources: ApplicationSources,
  userId: string,
) {
  const context = reviewContext(sources, userId);
  return evolveApplicationAiContent({
    current,
    command:
      mutation.kind === "apply_client_edits"
        ? { kind: "apply_client_edits", submitted: mutation.submitted }
        : { kind: "discard_edits" },
    ...(context ? { reviewContext: context } : {}),
  });
}

function lockedMissingResult(
  mutation: ApplicationEditMutation,
): ApplicationEditFailure {
  return mutation.kind === "apply_client_edits"
    ? { kind: "not_found" }
    : { kind: "stale_write" };
}

async function applyApplicationEdit(
  tx: Prisma.TransactionClient,
  input: ApplicationEditInput,
  preflight: ApplicationEditPreflight,
): Promise<DiscardApplicationEditsResult> {
  await acquireApplicationMutationLock(
    tx,
    input.userId,
    preflight.jobId ?? preflight.id,
  );
  const current = await loadLockedApplicationEdit(tx, input);
  if (!current) return lockedMissingResult(input.mutation);
  if (current.aiContentHash !== input.expectedHash) {
    return { kind: "stale_write", currentHash: current.aiContentHash };
  }
  if (
    current.jobId !== preflight.jobId ||
    current.resumeProfileId !== preflight.resumeProfileId
  ) {
    return { kind: "stale_render_context" };
  }

  if (!current.aiContent) {
    return input.mutation.kind === "discard_edits"
      ? { kind: "no_ai_content" }
      : { kind: "invalid_ai_content" };
  }
  const parsed = aiContentSchema.safeParse(current.aiContent);
  if (!parsed.success) return { kind: "invalid_ai_content" };

  const sources = await lockCurrentApplicationEditSources(
    tx,
    input,
    current,
    preflightSources(preflight, input.userId),
  );
  if (!sources) return { kind: "stale_render_context" };

  const evolved = applicationEditMutationResult(
    parsed.data,
    input.mutation,
    sources,
    input.userId,
  );
  if (evolved.kind !== "evolved") {
    return { kind: "canonical_evidence_unavailable" };
  }

  const aiContent = evolved.aiContent;
  const aiContentHash = hashAiContent(aiContent);
  const transition = transitionApplicationPublication({
    previousAiContent: parsed.data,
    previous: {
      status: current.status,
      aiContentHash: current.aiContentHash,
      resumePdfUrl: current.resumePdfUrl,
      coverPdfUrl: current.coverPdfUrl,
      resumeContentHash: current.resumeContentHash,
      coverContentHash: current.coverContentHash,
      resumePublishedHash: current.resumePublishedHash,
      coverPublishedHash: current.coverPublishedHash,
    },
    nextAiContent: aiContent,
    renderContext: publicationRenderContext(sources),
    publishedTargets: [],
  });
  const updated = await tx.application.updateMany({
    where: {
      id: input.applicationId,
      userId: input.userId,
      jobId: preflight.jobId,
      resumeProfileId: preflight.resumeProfileId,
      aiContentHash: input.expectedHash,
    },
    data: {
      ...transition.persistence,
      aiContent,
      aiContentHash,
      reviewReport: aiContent.review ?? undefined,
    },
  });
  if (updated.count !== 1) return { kind: "stale_write" };

  await persistReviewLedger(tx, {
    userId: input.userId,
    applicationId: input.applicationId,
    jobId: current.jobId,
    aiContent,
  });
  return {
    kind: "committed",
    aiContent,
    aiContentHash,
    publication: transition.publication,
  };
}

async function commitApplicationEdit(
  input: ApplicationEditIdentity & {
    mutation: { kind: "apply_client_edits"; submitted: AiContent };
  },
): Promise<AutoSaveApplicationEditResult>;
async function commitApplicationEdit(
  input: ApplicationEditIdentity & {
    mutation: { kind: "discard_edits" };
  },
): Promise<DiscardApplicationEditsResult>;
async function commitApplicationEdit(
  input: ApplicationEditInput,
): Promise<DiscardApplicationEditsResult> {
  const preflight = await loadApplicationEditPreflight(input);
  if (!preflight) return { kind: "not_found" };
  if (preflight.aiContentHash !== input.expectedHash) {
    return { kind: "stale_write", currentHash: preflight.aiContentHash };
  }
  return prisma.$transaction(
    (tx) => applyApplicationEdit(tx, input, preflight),
    { timeout: APPLICATION_EDIT_TRANSACTION_TIMEOUT_MS },
  );
}

/**
 * Auto-save browser decisions into the server-owned AI Content aggregate.
 * Model output, Evidence, Review, provenance and publication state remain
 * server-derived behind this interface.
 */
export function autoSaveApplicationEdit(
  input: ApplicationEditIdentity & { submittedAiContent: AiContent },
): Promise<AutoSaveApplicationEditResult> {
  return commitApplicationEdit({
    ...input,
    mutation: {
      kind: "apply_client_edits",
      submitted: input.submittedAiContent,
    },
  });
}

/** Reset browser decisions to the stored AI proposal without publishing. */
export function discardApplicationEdits(
  input: ApplicationEditIdentity,
): Promise<DiscardApplicationEditsResult> {
  return commitApplicationEdit({
    ...input,
    mutation: { kind: "discard_edits" },
  });
}
