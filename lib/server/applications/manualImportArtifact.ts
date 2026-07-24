import { buildCoverEvidenceContext } from "@/lib/server/ai/coverContext";
import { evaluateCoverQuality } from "@/lib/server/ai/coverQuality";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import {
  buildPdfFilename,
  resumeFilenameSegments,
} from "@/lib/server/files/pdfFilename";
import type { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiAddedBullet,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import {
  canonicalizeLatestBullets,
  getLatestRawBullets,
  isGroundedAddedBullet,
  isNonRedundantAddedBullet,
  parseCoverManualOutput,
  parseCoverStrictOutput,
  parseResumeManualOutput,
  parseResumeStrictOutput,
} from "./manualImportParser";
import { composeApplicationResumeRenderInput } from "./applicationResumeComposition";

type ResumeRenderInput = ReturnType<typeof mapResumeProfile>;

type ManualImportTarget = "resume" | "cover";
type ManualImportMode = "legacy" | "strict";
type ManualImportSource = "manual_import" | "local_ai";

type ManualImportJob = {
  title: string;
  company: string | null;
  description: string | null;
};

type ManualImportProfile = Record<string, unknown>;

type ManualImportArtifactError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

type ManualImportArtifactResult =
  | {
      ok: true;
      tex: string;
      filename: string;
      coverQualityGate: string;
      coverQualityIssueCount: number;
      /**
       * Canonical, render-reproducible AI proposals + the user's
       * accept/reject/edit decisions. Persisted on Application.aiContent.
       * Resume target captures the summary and grounded bullets. Cover
       * target captures its three editable paragraphs.
       */
      aiContent: AiContent;
    }
  | {
      ok: false;
      error: ManualImportArtifactError;
    };

function emptyCoverParagraph() {
  return { aiText: "", accepted: false };
}

function emptyCover(): AiContent["cover"] {
  return {
    paragraphOne: emptyCoverParagraph(),
    paragraphTwo: emptyCoverParagraph(),
    paragraphThree: emptyCoverParagraph(),
  };
}

function parseFilename(candidate: string, role: string, target: ManualImportTarget) {
  return target === "cover"
    ? buildPdfFilename(candidate, role, "cl")
    : buildPdfFilename(candidate, role, "cv");
}

export function buildManualImportArtifact(input: {
  evidenceScopeKey: string;
  target: ManualImportTarget;
  modelOutput: string;
  mode: ManualImportMode;
  source: ManualImportSource;
  promptMetaHash: string;
  renderInput: ResumeRenderInput;
  profile: ManualImportProfile;
  job: ManualImportJob;
}): ManualImportArtifactResult {
  return input.target === "resume"
    ? buildManualResumeArtifact(input)
    : buildManualCoverArtifact(input);
}

function buildManualResumeArtifact(input: {
  evidenceScopeKey: string;
  modelOutput: string;
  mode: ManualImportMode;
  source: ManualImportSource;
  promptMetaHash: string;
  renderInput: ResumeRenderInput;
  profile: ManualImportProfile;
  job: ManualImportJob;
}): ManualImportArtifactResult {
  const resumeParsed =
    input.mode === "strict"
      ? parseResumeStrictOutput(input.modelOutput)
      : parseResumeManualOutput(input.modelOutput);
  if (!resumeParsed.data) {
    return {
      ok: false,
      error: {
        status: 400,
        code: input.mode === "strict" ? "INVALID_AI_RESULT" : "PARSE_FAILED",
        message:
          input.mode === "strict"
            ? "Local AI returned invalid resume JSON. Run it again or use the manual method."
            : "Unable to parse model output. Resume JSON must include cvSummary and latestExperience.bullets.",
        details: resumeParsed.issues.slice(0, 8),
      },
    };
  }

  const resumeOutput = resumeParsed.data;
  const cvSummary = resumeOutput.cvSummary.trim();
  const baseLatest = input.renderInput.experiences[0];
  const baseLatestRawBullets = getLatestRawBullets(input.profile);
  const baseBulletsForMatch =
    baseLatestRawBullets.length > 0
      ? baseLatestRawBullets
      : baseLatest?.bullets.map((item) => item.trim()).filter(Boolean) ?? [];
  const incomingBullets = resumeOutput.latestExperience?.bullets;
  const aiAddedBullets: AiAddedBullet[] = [];

  if (baseLatest && incomingBullets) {
    const maxAllowed = Math.max(baseBulletsForMatch.length + 3, 3);
    if (incomingBullets.length > maxAllowed) {
      return {
        ok: false,
        error: {
          status: 400,
          code: "INVALID_LATEST_EXPERIENCE_BULLETS",
          message: `latestExperience.bullets exceeds allowed size (${maxAllowed}).`,
        },
      };
    }

    const { addedBullets } = canonicalizeLatestBullets(
      baseBulletsForMatch,
      incomingBullets,
    );
    const acceptedAddedBullets: string[] = [];

    for (const bullet of addedBullets) {
      const grounded = isGroundedAddedBullet(bullet, baseBulletsForMatch);
      const nonRedundant = grounded
        ? isNonRedundantAddedBullet(bullet, baseBulletsForMatch, acceptedAddedBullets)
        : false;
      const passed = grounded && nonRedundant;
      const reason = !grounded
        ? "ungrounded: no JD or master-profile evidence"
        : !nonRedundant
          ? "redundant: too similar to an existing bullet"
          : undefined;

      aiAddedBullets.push({
        text: bullet,
        accepted: passed,
        qualityGate: { passed, ...(reason ? { reason } : {}) },
      });

      if (passed) {
        acceptedAddedBullets.push(bullet);
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const aiContent = attachEvidenceAndReview({
    scopeKey: input.evidenceScopeKey,
    resumeSnapshot: {
      profile: input.profile,
      renderInput: input.renderInput,
    },
    jobDescription: input.job.description,
    aiContent: {
      schemaVersion: AI_CONTENT_SCHEMA_VERSION,
      generatedAt,
      promptMetaHash: input.promptMetaHash,
      source: input.source,
      provenance: {
        resume: {
          generatedAt,
          promptMetaHash: input.promptMetaHash,
          source: input.source,
        },
      },
      cv: {
        summary: {
          aiText: cvSummary,
          originalText: input.renderInput.summary ?? "",
          accepted: true,
        },
        latestExperience: {
          experienceIndex: 0,
          addedBullets: aiAddedBullets,
        },
      },
      cover: emptyCover(),
    },
  });

  return {
    ok: true,
    tex: renderResumeTex(
      composeApplicationResumeRenderInput({
        master: input.renderInput,
        cv: aiContent.cv,
      }),
    ),
    filename: parseFilename(resumeFilenameSegments(input.profile).name, input.job.title, "resume"),
    coverQualityGate: "pass",
    coverQualityIssueCount: 0,
    aiContent,
  };
}

function buildManualCoverArtifact(input: {
  evidenceScopeKey: string;
  modelOutput: string;
  mode: ManualImportMode;
  source: ManualImportSource;
  promptMetaHash: string;
  renderInput: ResumeRenderInput;
  profile: ManualImportProfile;
  job: ManualImportJob;
}): ManualImportArtifactResult {
  const coverParsed =
    input.mode === "strict"
      ? parseCoverStrictOutput(input.modelOutput)
      : parseCoverManualOutput(input.modelOutput);
  if (!coverParsed.data) {
    return {
      ok: false,
      error: {
        status: 400,
        code: input.mode === "strict" ? "INVALID_AI_RESULT" : "PARSE_FAILED",
        message:
          input.mode === "strict"
            ? "Local AI returned invalid cover-letter JSON. Run it again or use the manual method."
            : "Unable to parse model output. Cover JSON must include cover.paragraphOne/paragraphTwo/paragraphThree.",
        details: coverParsed.issues.slice(0, 8),
      },
    };
  }

  const coverOutput = coverParsed.data;
  const p1 = coverOutput.cover.paragraphOne.trim();
  const p2 = coverOutput.cover.paragraphTwo.trim();
  const p3 = coverOutput.cover.paragraphThree.trim();
  const profileSummary =
    typeof input.profile.summary === "string" && input.profile.summary.trim().length > 0
      ? input.profile.summary
      : input.renderInput.summary;
  const coverContext = buildCoverEvidenceContext({
    baseSummary: profileSummary,
    description: input.job.description || "",
    resumeSnapshot: input.profile,
  });
  const qualityReport = evaluateCoverQuality({
    draft: {
      candidateTitle: coverOutput.cover.candidateTitle,
      subject: coverOutput.cover.subject,
      date: coverOutput.cover.date,
      salutation: coverOutput.cover.salutation,
      paragraphOne: p1,
      paragraphTwo: p2,
      paragraphThree: p3,
      closing: coverOutput.cover.closing,
      signatureName: coverOutput.cover.signatureName,
    },
    context: coverContext,
    company: input.job.company || "the company",
    targetWordRange: { min: 280, max: 360 },
  });

  const generatedAt = new Date().toISOString();
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
      candidateTitle: coverOutput.cover.candidateTitle,
      subject: coverOutput.cover.subject,
      date: coverOutput.cover.date,
      salutation: coverOutput.cover.salutation,
      paragraphOne: p1,
      paragraphTwo: p2,
      paragraphThree: p3,
      closing: coverOutput.cover.closing,
      signatureName: coverOutput.cover.signatureName,
    }),
    filename: parseFilename(resumeFilenameSegments(input.profile).name, input.job.title, "cover"),
    coverQualityGate: qualityReport.passed ? "pass" : "soft-fail",
    coverQualityIssueCount: qualityReport.issues.length,
    aiContent: attachEvidenceAndReview({
      scopeKey: input.evidenceScopeKey,
      resumeSnapshot: {
        profile: input.profile,
        renderInput: input.renderInput,
      },
      jobDescription: input.job.description,
      aiContent: {
        schemaVersion: AI_CONTENT_SCHEMA_VERSION,
        generatedAt,
        promptMetaHash: input.promptMetaHash,
        source: input.source,
        provenance: {
          cover: {
            generatedAt,
            promptMetaHash: input.promptMetaHash,
            source: input.source,
          },
        },
        cv: {
          summary: { aiText: "", originalText: input.renderInput.summary ?? "", accepted: false },
          latestExperience: { experienceIndex: 0, addedBullets: [] },
        },
        cover: {
          paragraphOne: { aiText: p1, accepted: true },
          paragraphTwo: { aiText: p2, accepted: true },
          paragraphThree: { aiText: p3, accepted: true },
        },
      },
    }),
  };
}
