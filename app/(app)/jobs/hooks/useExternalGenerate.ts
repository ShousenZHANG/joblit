import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import type { JobItem, ExternalPromptMeta, CvSource, CoverSource } from "../types";
import { getErrorMessage } from "../types";
import type { DialogPhase } from "../components/StepIndicator";
import type {
  TailorReviewDraft,
  TailorReviewFinalized,
} from "../components/TailorReviewDialog";
import { isSkillPackFresh, writeSavedSkillPackMeta } from "../utils/skillPackMeta";
import { parseTailorOutput, filenameFromDisposition } from "../utils/tailorParser";
import {
  invalidateActiveJobsQueries,
  patchGeneratedJobArtifactInJobsCache,
} from "../utils/jobsQueryCache";

export type GeneratedDraftSource = "manual_import" | "local_ai";

/** Import rejection carrying the server's stable code + validator details. */
export class DraftImportError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly details: string[],
  ) {
    super(message);
    this.name = "DraftImportError";
  }
}

export type PersistedGeneratedDraft = {
  applicationId: string;
  status: "DRAFT" | "FINAL";
  aiContentHash: string | null;
  aiContent: AiContent;
  job: {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
  };
};

export async function persistGeneratedDraft(input: {
  jobId: string;
  target: "resume" | "cover";
  modelOutput: string;
  promptMeta?: Record<string, unknown> | ExternalPromptMeta | null;
  source: GeneratedDraftSource;
}): Promise<PersistedGeneratedDraft> {
  const response = await fetch("/api/applications/manual-generate?finalize=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const baseMessage = json?.error?.message || json?.error || "Failed to import generated content";
    const details = Array.isArray(json?.error?.details)
      ? json.error.details.filter((item: unknown) => typeof item === "string")
      : [];
    const detailText = details.length ? ` (${details.slice(0, 2).join(" | ")})` : "";
    const code = typeof json?.error?.code === "string" ? json.error.code : null;
    throw new DraftImportError(`${baseMessage}${detailText}`, code, details);
  }
  if (
    !json?.applicationId ||
    !json?.aiContent ||
    !json?.job?.id ||
    typeof json.job.title !== "string"
  ) {
    throw new Error("Unexpected response: missing editable draft metadata");
  }
  return {
    applicationId: json.applicationId,
    status: json.status === "FINAL" ? "FINAL" : "DRAFT",
    aiContentHash: typeof json.aiContentHash === "string" ? json.aiContentHash : null,
    aiContent: json.aiContent as AiContent,
    job: {
      id: json.job.id,
      title: json.job.title,
      company: typeof json.job.company === "string" ? json.job.company : null,
      location: typeof json.job.location === "string" ? json.job.location : null,
    },
  };
}

export function useExternalGenerate(setError: (e: string | null) => void) {
  const { toast } = useToast();
  const { markTaskComplete } = useGuide();
  const queryClient = useQueryClient();

  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [externalPromptLoading, setExternalPromptLoading] = useState(false);
  const [externalSkillPackLoading, setExternalSkillPackLoading] = useState(false);
  const [externalTarget, setExternalTarget] = useState<"resume" | "cover">("resume");
  const [externalPromptText, setExternalPromptText] = useState("");
  const [externalShortPromptText, setExternalShortPromptText] = useState("");
  const [externalModelOutput, setExternalModelOutput] = useState("");
  const [externalGenerating, setExternalGenerating] = useState(false);
  const [externalStep, setExternalStep] = useState<1 | 2 | 3>(1);
  const [externalPromptMeta, setExternalPromptMeta] = useState<ExternalPromptMeta | null>(null);
  const [externalSkillPackFresh, setExternalSkillPackFresh] = useState(false);
  const [dialogPhase, setDialogPhase] = useState<DialogPhase>(1);
  const [promptCopied, setPromptCopied] = useState(false);
  const [tailorSourceByJob, setTailorSourceByJob] = useState<
    Record<string, { cv?: CvSource; cover?: CoverSource }>
  >({});
  const [tailorReviewDraft, setTailorReviewDraft] =
    useState<TailorReviewDraft | null>(null);

  const openTailorReviewFromPersistedDraft = useCallback(async (input: {
    draft: PersistedGeneratedDraft;
    target: "resume" | "cover";
    source: GeneratedDraftSource;
    resumePdfUrl?: string | null;
    coverPdfUrl?: string | null;
  }) => {
    const { draft, target, source } = input;
    markTaskComplete("generate_first_pdf");
    setTailorSourceByJob((prev) => ({
      ...prev,
      [draft.job.id]: {
        ...prev[draft.job.id],
        ...(target === "resume"
          ? { cv: source as CvSource }
          : { cover: source as CoverSource }),
      },
    }));
    await invalidateActiveJobsQueries(queryClient);
    setTailorReviewDraft({
      applicationId: draft.applicationId,
      target,
      initialStatus: draft.status,
      initialAiContent: draft.aiContent,
      initialAiContentHash: draft.aiContentHash,
      resumePdfUrl: input.resumePdfUrl ?? null,
      coverPdfUrl: input.coverPdfUrl ?? null,
      source,
      job: draft.job,
    });
  }, [markTaskComplete, queryClient]);

  async function loadTailorPrompt(job: JobItem, target: "resume" | "cover"): Promise<{
    promptText: string;
    shortPromptText: string;
    promptMeta: ExternalPromptMeta | null;
  }> {
    const res = await fetch("/api/applications/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, target }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error?.message || json?.error || "Failed to build prompt");
    }
    const fullPromptText = [
      "You are given SYSTEM and USER instructions below. Follow them strictly. Output exactly one valid JSON object (no markdown or code fences).",
      "",
      "=== SYSTEM INSTRUCTIONS START ===",
      json.prompt?.systemPrompt ?? "",
      "=== SYSTEM INSTRUCTIONS END ===",
      "",
      "=== USER INSTRUCTIONS START ===",
      json.prompt?.userPrompt ?? "",
      "=== USER INSTRUCTIONS END ===",
    ].join("\n");
    const shortPromptText =
      typeof json.prompt?.shortUserPrompt === "string" && json.prompt.shortUserPrompt.trim().length > 0
        ? [
            "Follow your loaded joblit-tailoring pack. Output exactly one JSON object (no markdown or code fences).",
            "",
            json.prompt.shortUserPrompt,
          ].join("\n")
        : fullPromptText;
    const promptMeta: ExternalPromptMeta | null =
      json?.promptMeta &&
      typeof json.promptMeta.ruleSetId === "string" &&
      typeof json.promptMeta.resumeSnapshotUpdatedAt === "string"
        ? {
            ruleSetId: json.promptMeta.ruleSetId,
            resumeSnapshotUpdatedAt: json.promptMeta.resumeSnapshotUpdatedAt,
            promptTemplateVersion:
              typeof json.promptMeta.promptTemplateVersion === "string"
                ? json.promptMeta.promptTemplateVersion
                : undefined,
            schemaVersion:
              typeof json.promptMeta.schemaVersion === "string"
                ? json.promptMeta.schemaVersion
                : undefined,
            skillPackVersion:
              typeof json.promptMeta.skillPackVersion === "string"
                ? json.promptMeta.skillPackVersion
                : undefined,
            promptHash: typeof json.promptMeta.promptHash === "string" ? json.promptMeta.promptHash : undefined,
          }
        : null;
    return { promptText: fullPromptText, shortPromptText, promptMeta };
  }

  const openExternalGenerateDialog = useCallback(async (job: JobItem, target: "resume" | "cover") => {
    setExternalDialogOpen(true);
    setExternalTarget(target);
    setExternalStep(1);
    setDialogPhase(1);
    setExternalModelOutput("");
    setExternalPromptText("");
    setExternalShortPromptText("");
    setExternalPromptMeta(null);
    setExternalSkillPackFresh(false);
    setPromptCopied(false);
    setError(null);
    setExternalPromptLoading(true);
    try {
      const { promptText, shortPromptText, promptMeta } = await loadTailorPrompt(job, target);
      setExternalPromptText(promptText);
      setExternalShortPromptText(shortPromptText);
      setExternalPromptMeta(promptMeta);
      const fresh = isSkillPackFresh(promptMeta);
      setExternalSkillPackFresh(fresh);
      const initialStep = fresh ? 2 : 1;
      setExternalStep(initialStep as 1 | 2 | 3);
      setDialogPhase(initialStep as 1 | 2 | 3);
    } catch (e) {
      const message = getErrorMessage(e, "Failed to initialize external AI flow");
      setError(message);
      toast({
        title: "Generate failed",
        description: message,
        variant: "destructive",
        duration: 2600,
        className:
          "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
      });
    } finally {
      setExternalPromptLoading(false);
    }
  }, [setError, toast]);

  async function copySmartPrompt() {
    const text = externalSkillPackFresh && externalShortPromptText.trim()
      ? externalShortPromptText
      : externalPromptText;
    if (!text.trim()) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
      toast({
        title: "Prompt copied",
        description: "Paste into Claude/ChatGPT/Gemini, then copy the JSON result.",
        duration: 2200,
        className: "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
      });
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "joblit-tailor-prompt.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2500);
    toast({
      title: "Prompt downloaded",
      description: "Clipboard unavailable. Open the file and paste into your AI.",
      duration: 2200,
      className: "border-border bg-muted text-foreground animate-in fade-in zoom-in-95",
    });
  }

  async function downloadSkillPack() {
    if (externalPromptLoading || !externalPromptMeta) {
      return;
    }
    setExternalSkillPackLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prompt-rules/skill-pack", { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || json?.error || "Failed to download skill pack");
      }
      const blob = await res.blob();
      const fallbackName = "joblit-skills-v2.zip";
      const filename = filenameFromDisposition(res.headers.get("content-disposition")) || fallbackName;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      if (externalPromptMeta) {
        writeSavedSkillPackMeta(externalPromptMeta);
        setExternalSkillPackFresh(true);
        setExternalStep(2);
        setDialogPhase(2);
      }
      toast({
        title: "Skill pack downloaded",
        description: "Skill pack marked as up-to-date for current prompt.",
        duration: 2200,
        className:
          "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-900 animate-in fade-in zoom-in-95",
      });
    } catch (e) {
      const message = getErrorMessage(e, "Failed to download skill pack");
      setError(message);
      toast({
        title: "Download failed",
        description: message,
        variant: "destructive",
        duration: 2600,
        className:
          "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
      });
    } finally {
      setExternalSkillPackLoading(false);
    }
  }

  async function generateFromImportedJson(job: JobItem, target: "resume" | "cover", modelOutput: string) {
    setExternalGenerating(true);
    setDialogPhase("generating");
    setError(null);
    try {
      const draft = await persistGeneratedDraft({
        jobId: job.id,
        target,
        modelOutput,
        promptMeta: externalPromptMeta,
        source: "manual_import",
      });
      setExternalDialogOpen(false);
      setDialogPhase(1);
      await openTailorReviewFromPersistedDraft({
        draft,
        target,
        source: "manual_import",
        resumePdfUrl: target === "resume" ? null : job.resumePdfUrl ?? null,
        coverPdfUrl: target === "cover" ? null : job.coverPdfUrl ?? null,
      });
    } catch (e) {
      setDialogPhase(3);
      const message = getErrorMessage(e, "Failed to generate PDF");
      setError(message);
      toast({
        title: "Import failed",
        description: message,
        variant: "destructive",
        duration: 2600,
        className:
          "border-destructive/30 bg-destructive/10 text-rose-900 animate-in fade-in zoom-in-95",
      });
    } finally {
      setExternalGenerating(false);
    }
  }

  const parsedExternalOutput = useMemo(
    () => parseTailorOutput(externalModelOutput, externalTarget),
    [externalModelOutput, externalTarget],
  );

  function closeTailorReview() {
    setTailorReviewDraft(null);
  }

  function handleTailorReviewFinalized(result: TailorReviewFinalized) {
    const jobId = tailorReviewDraft?.job.id;
    if (!jobId) return;

    const finalizedSource = tailorReviewDraft?.source ?? "manual_import";
    setTailorSourceByJob((prev) => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        ...(result.target === "resume"
          ? { cv: finalizedSource as CvSource }
          : { cover: finalizedSource as CoverSource }),
      },
    }));

    patchGeneratedJobArtifactInJobsCache({
      queryClient,
      id: jobId,
      patch:
        result.target === "resume"
          ? {
              resumePdfUrl: result.resumePdfUrl ?? null,
              resumePdfName: result.resumePdfName ?? null,
            }
          : { coverPdfUrl: result.coverPdfUrl ?? null },
    });
    void invalidateActiveJobsQueries(queryClient);
  }

  return {
    externalDialogOpen, setExternalDialogOpen,
    externalPromptLoading,
    externalSkillPackLoading,
    externalTarget,
    externalPromptText,
    externalShortPromptText,
    externalModelOutput, setExternalModelOutput,
    externalGenerating,
    externalStep, setExternalStep,
    externalPromptMeta,
    externalSkillPackFresh, setExternalSkillPackFresh,
    dialogPhase, setDialogPhase,
    promptCopied,
    tailorSourceByJob,
    tailorReviewDraft,
    parsedExternalOutput,
    openExternalGenerateDialog,
    copySmartPrompt,
    downloadSkillPack,
    generateFromImportedJson,
    closeTailorReview,
    handleTailorReviewFinalized,
    openTailorReviewFromPersistedDraft,
  };
}
