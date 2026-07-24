import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import {
  tailorApplicationContent,
  type TailorOptions,
  type TailorResult,
} from "@/lib/server/ai/tailorApplication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { composeApplicationResumeRenderInput } from "./applicationResumeComposition";

type ResumeJobContext = {
  title: string;
  company: string | null;
  description: string | null;
};

type ResumeProfileRecord = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/server/resumeProfile").getResumeProfile>>
>;

type ResumePdfResult = {
  pdf: Buffer;
  tex: string;
  cvSource: "ai" | "base";
  coverSource: "ai" | "fallback";
  tailorReason: string;
  renderInput: ReturnType<typeof mapResumeProfile>;
  cv: AiContent["cv"];
  tailored: TailorResult;
};

export async function buildResumePdfForJob(input: {
  userId: string;
  profile: ResumeProfileRecord;
  job: ResumeJobContext;
  tailorOptions?: TailorOptions;
}): Promise<ResumePdfResult> {
  const renderInput = mapResumeProfile(input.profile);
  const baseSummaryRaw = typeof input.profile.summary === "string" ? input.profile.summary : "";
  const tailored = await tailorApplicationContent({
    baseSummary: baseSummaryRaw,
    jobTitle: input.job.title,
    company: input.job.company || "the company",
    description: input.job.description || "",
    resumeSnapshot: input.profile,
    userId: input.userId,
  }, input.tailorOptions);

  const cv: AiContent["cv"] = {
    summary: {
      aiText: tailored.cvSummary,
      originalText: renderInput.summary,
      accepted: true,
    },
    latestExperience: {
      experienceIndex: 0,
      addedBullets: [],
    },
  };
  const tex = renderResumeTex(
    composeApplicationResumeRenderInput({
      master: renderInput,
      cv,
    }),
  );
  const pdf = await compileLatexToPdf(tex);

  return {
    pdf,
    tex,
    cvSource: tailored.source.cv,
    coverSource: tailored.source.cover,
    tailorReason: tailored.reason,
    renderInput,
    cv,
    tailored,
  };
}
