import { del, put } from "@vercel/blob";
import { AppError } from "@/lib/server/api/appError";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { escapeLatexWithBold } from "@/lib/server/latex/escapeLatex";
import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import {
  APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  buildApplicationArtifactBlobPath,
} from "@/lib/server/files/applicationArtifactBlob";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import {
  assertAtsPdf,
  type AtsPdfValidation,
} from "@/lib/server/applications/atsPdfValidator";

/**
 * Render the committed aiContent of a DRAFT Application into a final
 * PDF + persist it to Vercel Blob. Returns the public URL + filename
 * for the route to write back onto the row.
 *
 * Composition order:
 *   - Master profile is the spine (metadata, locked bullets, education).
 *   - aiContent.cv.summary.userEdit ?? aiContent.cv.summary.aiText replaces the summary.
 *   - aiContent.cv.latestExperience.addedBullets where accepted=true
 *     are appended to the latest experience's bullet list (after the
 *     base bullets the user did not delete).
 *   - The skills section comes from the master profile verbatim. The AI
 *     does not contribute skills to a finalized CV.
 */
type RenderApplicationInput = {
  applicationId: string;
  userId: string;
  resumeProfileId?: string | null;
  aiContent: AiContent;
  artifactVersion?: string | null;
  job: { id: string | null; title: string; company: string | null; market: string };
};

type FinalRenderApplicationInput = RenderApplicationInput & {
  resumeProfileId: string | null;
};

export async function renderApplicationPdf(
  input: RenderApplicationInput,
): Promise<{ pdf: Buffer; filename: string }> {
  const profileLocale = marketStringToResumeLocale(input.job.market);
  const profile = await getResumeProfile(input.userId, {
    profileId: input.resumeProfileId ?? undefined,
    locale: profileLocale,
  });
  if (!profile) {
    throw new AppError({
      code: "NO_PROFILE",
      status: 404,
      publicMessage: "No Master Resume Profile for this locale.",
    });
  }
  const renderInput = mapResumeProfile(profile);

  // Compose final summary
  const finalSummary =
    input.aiContent.cv.summary.userEdit?.trim() ||
    input.aiContent.cv.summary.aiText.trim() ||
    renderInput.summary;

  // Compose final latest-experience bullets: base bullets + accepted AI adds
  const acceptedAdded = input.aiContent.cv.latestExperience.addedBullets
    .filter((b) => b.accepted)
    .map((b) => (b.userEdit?.trim() || b.text).trim())
    .filter(Boolean);
  const expIdx = input.aiContent.cv.latestExperience.experienceIndex;
  const baseExperiences = renderInput.experiences;
  const targetExp = baseExperiences[expIdx];
  const nextExperiences = targetExp
    ? baseExperiences.map((exp, i) =>
        i === expIdx
          ? {
              ...exp,
              bullets: [...exp.bullets, ...acceptedAdded.map((b) => escapeLatexWithBold(b))],
            }
          : exp,
      )
    : baseExperiences;

  const tex = renderResumeTex({
    ...renderInput,
    summary: escapeLatexWithBold(finalSummary),
    experiences: nextExperiences,
    skills: renderInput.skills,
  });

  const pdf = await compileLatexToPdf(tex, {
    engine: profileLocale === "zh-CN" ? "xelatex" : "pdflatex",
  });
  const filename = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    input.job.title,
  );
  return { pdf, filename };
}

export async function renderFinalApplication(
  input: FinalRenderApplicationInput,
): Promise<{
  resumePdfUrl: string;
  resumePdfName: string;
  atsValidation: AtsPdfValidation;
}> {
  const { pdf, filename: resumePdfName } = await renderApplicationPdf(input);
  const atsValidation = await assertAtsPdf(pdf, {
    maxPages: 2,
    minTextChars: 180,
    requiredKeywords: buildAtsKeywords(input.aiContent, input.job.title),
  });
  const blobPath = buildApplicationArtifactBlobPath({
    userId: input.userId,
    jobId: input.job.id ?? input.applicationId,
    target: "resume",
    version: input.artifactVersion,
  });
  const blob = await put(blobPath, pdf, {
    access: "public",
    contentType: "application/pdf",
    ...APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  });

  return { resumePdfUrl: blob.url, resumePdfName, atsValidation };
}

/**
 * Cover-letter finalize: render LaTeX from accepted aiContent.cover
 * paragraphs, compile to PDF, upload to Blob.
 */
export async function renderFinalCoverLetter(input: {
  applicationId: string;
  userId: string;
  resumeProfileId: string | null;
  aiContent: AiContent;
  artifactVersion?: string | null;
  job: { id: string | null; title: string; company: string | null; market: string };
}): Promise<{
  coverPdfUrl: string;
  coverPdfName: string;
  atsValidation: AtsPdfValidation;
}> {
  const { pdf, filename: coverPdfName } = await renderCoverLetterPdf(input);
  const atsValidation = await assertAtsPdf(pdf, {
    maxPages: 2,
    minTextChars: 160,
    requiredKeywords: buildAtsKeywords(input.aiContent, input.job.title),
  });
  const blobPath = buildApplicationArtifactBlobPath({
    userId: input.userId,
    jobId: input.job.id ?? input.applicationId,
    target: "cover",
    version: input.artifactVersion,
  });
  const blob = await put(blobPath, pdf, {
    access: "public",
    contentType: "application/pdf",
    ...APPLICATION_ARTIFACT_OVERWRITE_OPTIONS,
  });

  return { coverPdfUrl: blob.url, coverPdfName, atsValidation };
}

export async function renderCoverLetterPdf(input: {
  applicationId: string;
  userId: string;
  resumeProfileId?: string | null;
  aiContent: AiContent;
  artifactVersion?: string | null;
  job: { id: string | null; title: string; company: string | null; market: string };
}): Promise<{ pdf: Buffer; filename: string }> {
  const profileLocale = marketStringToResumeLocale(input.job.market);
  const profile = await getResumeProfile(input.userId, {
    profileId: input.resumeProfileId ?? undefined,
    locale: profileLocale,
  });
  if (!profile) {
    throw new AppError({
      code: "NO_PROFILE",
      status: 404,
      publicMessage: "No Master Resume Profile for this locale.",
    });
  }
  const renderInput = mapResumeProfile(profile);

  const c = input.aiContent.cover;
  const p1 = (c.paragraphOne.userEdit?.trim() || c.paragraphOne.aiText).trim();
  const p2 = (c.paragraphTwo.userEdit?.trim() || c.paragraphTwo.aiText).trim();
  const p3 = (c.paragraphThree.userEdit?.trim() || c.paragraphThree.aiText).trim();

  if (!p1 || !p2 || !p3) {
    throw new AppError({
      code: "COVER_PARAGRAPHS_INCOMPLETE",
      status: 422,
      publicMessage: "The cover letter is missing one or more body paragraphs.",
    });
  }

  const tex = renderCoverLetterTex({
    candidate: {
      name: renderInput.candidate.name,
      title: renderInput.candidate.title,
      phone: renderInput.candidate.phone,
      email: renderInput.candidate.email,
      linkedinUrl: renderInput.candidate.linkedinUrl,
      linkedinText: renderInput.candidate.linkedinText,
    },
    company: input.job.company || "the company",
    role: input.job.title,
    paragraphOne: p1,
    paragraphTwo: p2,
    paragraphThree: p3,
  });

  const pdf = await compileLatexToPdf(tex, {
    engine: profileLocale === "zh-CN" ? "xelatex" : "pdflatex",
  });
  const filename = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    input.job.title,
    "cl",
  );
  return { pdf, filename };
}

export async function deleteApplicationArtifact(url: string | null | undefined) {
  if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return;
  await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
}

function buildAtsKeywords(aiContent: AiContent, jobTitle: string) {
  const values = [
    ...jobTitle.split(/[\s,/|()-]+/),
    ...(aiContent.review?.requirements ?? []).flatMap((item) =>
      item.text.split(/[\s,/|():;-]+/),
    ),
  ];
  const seen = new Set<string>();
  return values
    .map((value) => value.normalize("NFKC").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (value.length < 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}
