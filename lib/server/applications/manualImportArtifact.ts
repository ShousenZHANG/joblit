import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import type { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { acceptApplicationGeneration } from "./applicationGeneration";
import { composeApplicationResumeRenderInput } from "./applicationResumeComposition";

type ResumeRenderInput = ReturnType<typeof mapResumeProfile>;
type ManualImportTarget = "resume" | "cover";
type ManualImportSource = "manual_import" | "local_ai" | "codex_batch";

type ManualImportJob = {
  title: string;
  company: string | null;
  description: string | null;
};

type ManualImportArtifactResult =
  | {
      ok: true;
      tex: string;
      filename: string;
      coverQualityGate: string;
      coverQualityIssueCount: number;
      aiContent: AiContent;
    }
  | {
      ok: false;
      error: {
        status: number;
        code: string;
        message: string;
        details?: unknown;
      };
    };

function parseFilename(candidate: string, role: string, target: ManualImportTarget) {
  return target === "cover"
    ? buildPdfFilename(candidate, role, "cl")
    : buildPdfFilename(candidate, role, "cv");
}

/**
 * Rendering adapter retained for the manual-generate route. Generation output
 * parsing, normalization, Quality Gates, provenance and canonical AI Content
 * construction belong to acceptApplicationGeneration.
 *
 * Evidence and review do not: they describe the merged CV + Cover document, so
 * they are built once at the commit boundary. The AI Content returned here
 * carries no review, and no caller should gate on one.
 *
 * The authoritative decode policy is derived from `source`; callers cannot
 * select a more permissive dialect.
 */
export function buildManualImportArtifact(input: {
  evidenceScopeKey: string;
  target: ManualImportTarget;
  modelOutput: string;
  source: ManualImportSource;
  promptMetaHash: string;
  renderInput: ResumeRenderInput;
  profile: Record<string, unknown>;
  job: ManualImportJob;
}): ManualImportArtifactResult {
  const accepted = acceptApplicationGeneration({
    evidenceScopeKey: input.evidenceScopeKey,
    target: input.target,
    source: input.source,
    rawOutput: input.modelOutput,
    promptMetaHash: input.promptMetaHash,
    master: input.renderInput,
    profile: input.profile,
    job: input.job,
  });
  if (!accepted.ok) return accepted;

  const filename = parseFilename(
    resumeFilenameSegments(input.profile).name,
    input.job.title,
    input.target,
  );

  if (input.target === "resume") {
    return {
      ok: true,
      tex: renderResumeTex(
        composeApplicationResumeRenderInput({
          master: input.renderInput,
          cv: accepted.aiContent.cv,
        }),
      ),
      filename,
      coverQualityGate: accepted.coverQualityGate,
      coverQualityIssueCount: accepted.coverQualityIssueCount,
      aiContent: accepted.aiContent,
    };
  }

  const cover = accepted.aiContent.cover;
  return {
    ok: true,
    tex: renderCoverLetterTex({
      candidate: {
        name: input.renderInput.candidate.name,
        title: input.renderInput.candidate.title,
        phone: input.renderInput.candidate.phone,
        email: input.renderInput.candidate.email,
        linkedinUrl: input.renderInput.candidate.linkedinUrl,
        linkedinText: input.renderInput.candidate.linkedinText,
      },
      company: input.job.company || "the company",
      role: input.job.title,
      paragraphOne: cover.paragraphOne.aiText,
      paragraphTwo: cover.paragraphTwo.aiText,
      paragraphThree: cover.paragraphThree.aiText,
    }),
    filename,
    coverQualityGate: accepted.coverQualityGate,
    coverQualityIssueCount: accepted.coverQualityIssueCount,
    aiContent: accepted.aiContent,
  };
}
