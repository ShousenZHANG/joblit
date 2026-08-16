import { AppError } from "@/lib/server/api/appError";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import { coverParagraphTexts } from "@/lib/shared/aiContentText";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { composeApplicationResumeRenderInput } from "./applicationResumeComposition";

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
  /**
   * Immutable Profile snapshot already loaded with the Application. Finalize
   * supplies this so publication hashing and PDF rendering cannot observe two
   * different profile revisions.
   */
  profileSnapshot?: Parameters<typeof mapResumeProfile>[0];
  aiContent: AiContent;
  artifactVersion?: string | null;
  job: { id: string | null; title: string; company: string | null; market: string };
};

async function resolveRenderProfile(input: {
  userId: string;
  resumeProfileId?: string | null;
  profileSnapshot?: Parameters<typeof mapResumeProfile>[0];
  job: { market: string };
}) {
  if (input.profileSnapshot) return input.profileSnapshot;
  const profileLocale = marketStringToResumeLocale(input.job.market);
  return getResumeProfile(input.userId, {
    profileId: input.resumeProfileId ?? undefined,
    locale: profileLocale,
  });
}

export async function renderApplicationPdf(
  input: RenderApplicationInput,
): Promise<{ pdf: Buffer; filename: string }> {
  const profileLocale = marketStringToResumeLocale(input.job.market);
  const profile = await resolveRenderProfile(input);
  if (!profile) {
    throw new AppError({
      code: "NO_PROFILE",
      status: 404,
      publicMessage: "No Master Resume Profile for this locale.",
    });
  }
  const renderInput = mapResumeProfile(profile);
  const tex = renderResumeTex(
    composeApplicationResumeRenderInput({
      master: renderInput,
      cv: input.aiContent.cv,
    }),
  );

  const pdf = await compileLatexToPdf(tex, {
    engine: profileLocale === "zh-CN" ? "xelatex" : "pdflatex",
  });
  const filename = buildPdfFilename(
    resumeFilenameSegments(profile).name,
    input.job.title,
  );
  return { pdf, filename };
}

export async function renderCoverLetterPdf(input: {
  applicationId: string;
  userId: string;
  resumeProfileId?: string | null;
  /**
   * Immutable Profile snapshot already loaded with the Application. Finalize
   * supplies this so publication hashing and PDF rendering cannot observe two
   * different profile revisions.
   */
  profileSnapshot?: Parameters<typeof mapResumeProfile>[0];
  aiContent: AiContent;
  artifactVersion?: string | null;
  job: { id: string | null; title: string; company: string | null; market: string };
}): Promise<{ pdf: Buffer; filename: string }> {
  const profileLocale = marketStringToResumeLocale(input.job.market);
  const profile = await resolveRenderProfile(input);
  if (!profile) {
    throw new AppError({
      code: "NO_PROFILE",
      status: 404,
      publicMessage: "No Master Resume Profile for this locale.",
    });
  }
  const renderInput = mapResumeProfile(profile);

  const [p1, p2, p3] = coverParagraphTexts(input.aiContent.cover);

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

/**
 * The words a rendered PDF must contain to count as on-target.
 *
 * Only the job title feeds this now. It used to also mine the review's
 * extracted requirements, but that ledger is gone, and the title was always the
 * load-bearing half: it is what recruiters search on, and the summary lint
 * already guarantees the tailored summary states it.
 */
export function buildAtsKeywords(jobTitle: string) {
  const values = jobTitle.split(/[\s,/|()-]+/);
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
