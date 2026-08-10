import { createHash } from "node:crypto";
import { AppError } from "@/lib/server/api/appError";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  acceptedAddedBulletTexts,
  coverParagraphTexts,
  proposalText,
} from "@/lib/shared/aiContentText";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import type {
  ApplicationDocumentPublication,
  ApplicationDocumentTarget,
  ApplicationPublication,
} from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

const DOCUMENT_CONTENT_CONTRACT = "application-document-content/v2";

export interface ApplicationPublicationRenderContext {
  available: boolean;
  resume: unknown;
  cover: unknown;
}

export const UNAVAILABLE_APPLICATION_PUBLICATION_RENDER_CONTEXT: ApplicationPublicationRenderContext =
  {
    available: false,
    resume: { unavailable: true },
    cover: { unavailable: true },
  };

export function buildApplicationPublicationRenderContext(input: {
  profile: Parameters<typeof mapResumeProfile>[0];
  job: { title: string; company: string | null; market: string };
}): ApplicationPublicationRenderContext {
  const master = mapResumeProfile(input.profile);
  const locale = marketStringToResumeLocale(input.job.market);
  return {
    available: true,
    resume: {
      locale,
      master,
    },
    cover: {
      locale,
      candidate: {
        name: master.candidate.name,
        title: master.candidate.title,
        phone: master.candidate.phone,
        email: master.candidate.email,
        linkedinUrl: master.candidate.linkedinUrl,
        linkedinText: master.candidate.linkedinText,
      },
      company: input.job.company || "the company",
      role: input.job.title,
    },
  };
}

export interface ApplicationPublicationRecord {
  status: "DRAFT" | "FINAL";
  aiContentHash: string | null;
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
  resumeContentHash: string | null;
  coverContentHash: string | null;
  resumePublishedHash: string | null;
  coverPublishedHash: string | null;
}

export interface ApplicationPublicationPersistence {
  status: "DRAFT" | "FINAL";
  resumeContentHash: string | null;
  coverContentHash: string | null;
  resumePublishedHash: string | null;
  coverPublishedHash: string | null;
}

export function applicationPublicationRecord(
  existing:
    | Partial<ApplicationPublicationRecord>
    | null
    | undefined,
): ApplicationPublicationRecord {
  return {
    status: existing?.status ?? "DRAFT",
    aiContentHash: existing?.aiContentHash ?? null,
    resumePdfUrl: existing?.resumePdfUrl ?? null,
    coverPdfUrl: existing?.coverPdfUrl ?? null,
    resumeContentHash: existing?.resumeContentHash ?? null,
    coverContentHash: existing?.coverContentHash ?? null,
    resumePublishedHash: existing?.resumePublishedHash ?? null,
    coverPublishedHash: existing?.coverPublishedHash ?? null,
  };
}

export function publicationDocumentContentHashes(
  publication: ApplicationPublication,
) {
  return {
    ...(publication.resume.contentHash
      ? { RESUME: publication.resume.contentHash }
      : {}),
    ...(publication.cover.contentHash
      ? { COVER: publication.cover.contentHash }
      : {}),
  };
}

interface ProjectApplicationPublicationInput {
  aiContent: AiContent;
  record: ApplicationPublicationRecord;
  renderContext: ApplicationPublicationRenderContext;
}

interface TransitionApplicationPublicationInput {
  previousAiContent: AiContent | null;
  previous: ApplicationPublicationRecord;
  nextAiContent: AiContent;
  renderContext: ApplicationPublicationRenderContext;
  publishedTargets: readonly ApplicationDocumentTarget[];
  nextUrls?: Partial<Record<ApplicationDocumentTarget, string | null>>;
}

interface RebaseApplicationPublicationRenderContextInput {
  aiContent: AiContent;
  record: ApplicationPublicationRecord;
  previousRenderContext: ApplicationPublicationRenderContext;
  nextRenderContext: ApplicationPublicationRenderContext;
}

/**
 * Hash the part of AI Content that changes the selected document's rendered
 * proposal. Evidence, review timestamps and the other document are excluded.
 */
export function hashApplicationDocumentContent(
  aiContent: AiContent,
  target: ApplicationDocumentTarget,
  renderContext: ApplicationPublicationRenderContext,
): string | null {
  const decision =
    target === "resume"
      ? resumePublicationDecision(aiContent)
      : coverPublicationDecision(aiContent);
  if (decision === null) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: DOCUMENT_CONTENT_CONTRACT,
        target,
        renderContext: renderContext[target],
        decision,
      }),
    )
    .digest("hex");
}

/**
 * Read projection. Legacy aggregate hashes cannot prove the Profile, Job and
 * locale inputs covered by the v2 document hash, so only an explicit target
 * published hash may establish FINAL.
 */
export function projectApplicationPublication({
  aiContent,
  record,
  renderContext,
}: ProjectApplicationPublicationInput): ApplicationPublication {
  const resume = projectDocument(aiContent, record, renderContext, "resume");
  const cover = projectDocument(aiContent, record, renderContext, "cover");
  return {
    status: aggregateStatus([resume, cover]),
    resume,
    cover,
  };
}

/**
 * The only state transition for publication columns.
 *
 * Unpublished targets carry their previous published hash forward, so editing
 * Cover cannot dirty Resume. Publishing advances only the selected target(s).
 */
export function transitionApplicationPublication(
  input: TransitionApplicationPublicationInput,
): {
  publication: ApplicationPublication;
  persistence: ApplicationPublicationPersistence;
} {
  const previousPublication = input.previousAiContent
    ? projectApplicationPublication({
        aiContent: input.previousAiContent,
        record: input.previous,
        renderContext: input.renderContext,
      })
    : null;
  const published = new Set(input.publishedTargets);
  const resumeContentHash = hashApplicationDocumentContent(
    input.nextAiContent,
    "resume",
    input.renderContext,
  );
  const coverContentHash = hashApplicationDocumentContent(
    input.nextAiContent,
    "cover",
    input.renderContext,
  );
  const resumePublishedHash = nextPublishedHash({
    target: "resume",
    contentHash: resumeContentHash,
    published,
    previousPublication,
  });
  const coverPublishedHash = nextPublishedHash({
    target: "cover",
    contentHash: coverContentHash,
    published,
    previousPublication,
  });
  const nextRecord: ApplicationPublicationRecord = {
    ...input.previous,
    resumePdfUrl:
      input.nextUrls?.resume === undefined
        ? input.previous.resumePdfUrl
        : input.nextUrls.resume,
    coverPdfUrl:
      input.nextUrls?.cover === undefined
        ? input.previous.coverPdfUrl
        : input.nextUrls.cover,
    resumeContentHash,
    coverContentHash,
    resumePublishedHash,
    coverPublishedHash,
  };
  const publication = projectApplicationPublication({
    aiContent: input.nextAiContent,
    record: nextRecord,
    renderContext: input.renderContext,
  });
  return {
    publication,
    persistence: publicationPersistence(publication),
  };
}

/**
 * Advance publication state after an external render dependency changes.
 *
 * Each target carries forward only the publication proof established under
 * the previous context. The next target hash is then computed independently,
 * so a Resume-only Profile edit cannot dirty an unchanged Cover (and vice
 * versa).
 */
export function rebaseApplicationPublicationForRenderContext(
  input: RebaseApplicationPublicationRenderContextInput,
): {
  publication: ApplicationPublication;
  persistence: ApplicationPublicationPersistence;
} {
  const previousPublication = projectApplicationPublication({
    aiContent: input.aiContent,
    record: input.record,
    renderContext: input.previousRenderContext,
  });
  const nextRecord: ApplicationPublicationRecord = {
    ...input.record,
    resumeContentHash: hashApplicationDocumentContent(
      input.aiContent,
      "resume",
      input.nextRenderContext,
    ),
    coverContentHash: hashApplicationDocumentContent(
      input.aiContent,
      "cover",
      input.nextRenderContext,
    ),
    resumePublishedHash: previousPublication.resume.publishedHash,
    coverPublishedHash: previousPublication.cover.publishedHash,
  };
  const publication = projectApplicationPublication({
    aiContent: input.aiContent,
    record: nextRecord,
    renderContext: input.nextRenderContext,
  });
  return {
    publication,
    persistence: publicationPersistence(publication),
  };
}

function resumePublicationDecision(aiContent: AiContent) {
  const summary = proposalText(aiContent.cv.summary);
  const addedBullets = acceptedAddedBulletTexts(
    aiContent.cv.latestExperience.addedBullets,
  );
  return {
    summary,
    experienceIndex: aiContent.cv.latestExperience.experienceIndex,
    addedBullets,
  };
}

function coverPublicationDecision(aiContent: AiContent) {
  const paragraphs = coverParagraphTexts(aiContent.cover);
  return paragraphs.some(Boolean) ? { paragraphs } : null;
}

function projectDocument(
  aiContent: AiContent,
  record: ApplicationPublicationRecord,
  renderContext: ApplicationPublicationRenderContext,
  target: ApplicationDocumentTarget,
): ApplicationDocumentPublication {
  const contentHash = hashApplicationDocumentContent(
    aiContent,
    target,
    renderContext,
  );
  const url =
    target === "resume" ? record.resumePdfUrl : record.coverPdfUrl;
  const storedPublishedHash =
    target === "resume"
      ? record.resumePublishedHash
      : record.coverPublishedHash;
  const publishedHash =
    renderContext.available && url && storedPublishedHash
      ? storedPublishedHash
      : null;
  return {
    status:
      contentHash === null
        ? "MISSING"
        : url && publishedHash === contentHash
          ? "FINAL"
          : "DRAFT",
    contentHash,
    publishedHash,
  };
}

function aggregateStatus(
  documents: readonly ApplicationDocumentPublication[],
): "DRAFT" | "FINAL" {
  const present = documents.filter((document) => document.status !== "MISSING");
  return present.length > 0 &&
    present.every((document) => document.status === "FINAL")
    ? "FINAL"
    : "DRAFT";
}

function publicationPersistence(
  publication: ApplicationPublication,
): ApplicationPublicationPersistence {
  return {
    status: publication.status,
    resumeContentHash: publication.resume.contentHash,
    coverContentHash: publication.cover.contentHash,
    resumePublishedHash: publication.resume.publishedHash,
    coverPublishedHash: publication.cover.publishedHash,
  };
}

function nextPublishedHash(input: {
  target: ApplicationDocumentTarget;
  contentHash: string | null;
  published: ReadonlySet<ApplicationDocumentTarget>;
  previousPublication: ApplicationPublication | null;
}): string | null {
  if (input.published.has(input.target)) {
    if (!input.contentHash) {
      // A document that is already published has stopped being publishable —
      // its half of the merged AI Content no longer yields a render decision.
      // Reachable when a second target's import rebuilds the shared review and
      // that rebuild retracts the first target's claims.
      //
      // This used to be a bare Error, which meant a genuine, permanent
      // conflict left the route with no mapped response: Next answered 500
      // with no body, the Runner read that as "settlement unknown", replayed
      // the identical receipt three times and deferred — an outage shape for
      // a state no retry can change. Typed and non-retryable now, so the
      // caller is told to regenerate instead of being asked to wait.
      throw new AppError({
        code: "APPLICATION_DOCUMENT_MISSING",
        status: 409,
        publicMessage:
          "A published document is no longer complete after merging the other one. Generate this job again.",
        publicDetails: { target: input.target },
        privateDetails: {
          target: input.target,
          published: [...input.published],
        },
      });
    }
    return input.contentHash;
  }
  return input.previousPublication?.[input.target].publishedHash ?? null;
}
