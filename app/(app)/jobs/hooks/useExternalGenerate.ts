import { useCallback, useMemo, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
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
import { marketStringToResumeLocale } from "@/lib/shared/market";
import {
  invalidateActiveJobsQueries,
  patchGeneratedJobArtifactInJobsCache,
} from "../utils/jobsQueryCache";
import type { TailoringRunHandle } from "@/lib/shared/tailoringRunContract";

export type GeneratedDraftSource = "manual_import" | "local_ai";

const MANUAL_TAILORING_ISSUE_PREFIX = "joblit.tailoring.manual.v1";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function manualIssueStorageKey(jobId: string, target: "resume" | "cover") {
  return `${MANUAL_TAILORING_ISSUE_PREFIX}:${jobId}:${target}`;
}

function getOrCreateManualIssueKey(
  jobId: string,
  target: "resume" | "cover",
): string {
  const storageKey = manualIssueStorageKey(jobId, target);
  const existing =
    typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey);
  if (existing && UUID_RE.test(existing)) return existing;
  const created = crypto.randomUUID();
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(storageKey, created);
  }
  return created;
}

function clearManualIssueKey(jobId: string, target: "resume" | "cover") {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(manualIssueStorageKey(jobId, target));
  }
}

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
  /** Canonical `{Full Name} {Title}_{CV|CL}.pdf` for the review dialog's download. */
  pdfName: string | null;
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
  tailoringRun?: TailoringRunHandle | null;
  source: GeneratedDraftSource;
}): Promise<PersistedGeneratedDraft> {
  type ManualGenerateResponse = {
    applicationId?: string;
    status?: string;
    aiContentHash?: unknown;
    aiContent?: unknown;
    pdfName?: unknown;
    job?: { id?: string; title?: unknown; company?: unknown; location?: unknown };
  };

  let json: ManualGenerateResponse | null;
  try {
    json = (await fetchJson("/api/applications/manual-generate?finalize=false", {
      method: "POST",
      body: JSON.stringify(input),
      fallbackError: "Failed to import generated content",
    })) as ManualGenerateResponse | null;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // `details` is a string array for the import validators and a Zod flatten
    // for a schema rejection; only the former is renderable.
    const details = Array.isArray(err.details)
      ? err.details.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const detailText = details.length ? ` (${details.slice(0, 2).join(" | ")})` : "";
    throw new DraftImportError(`${err.message}${detailText}`, err.code, details);
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
    pdfName: typeof json.pdfName === "string" ? json.pdfName : null,
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
  const [externalTailoringRun, setExternalTailoringRun] =
    useState<TailoringRunHandle | null>(null);
  const [externalSkillPackFresh, setExternalSkillPackFresh] = useState(false);
  const [externalSkillPackLocale, setExternalSkillPackLocale] =
    useState<"en-AU" | "zh-CN">("en-AU");
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
      pdfName: draft.pdfName,
      source,
      job: draft.job,
    });
  }, [markTaskComplete, queryClient]);

  async function loadTailorPrompt(job: JobItem, target: "resume" | "cover"): Promise<{
    promptText: string;
    shortPromptText: string;
    promptMeta: ExternalPromptMeta | null;
    tailoringRun: TailoringRunHandle | null;
  }> {
    type TailorPromptResponse = {
      prompt?: { systemPrompt?: string; userPrompt?: string; shortUserPrompt?: string };
      promptMeta?: Record<string, unknown>;
      tailoringRun?: { id?: unknown; attemptId?: unknown };
    };
    const requestPrompt = (issueKey: string) =>
      fetchJson("/api/applications/prompt", {
        method: "POST",
        body: JSON.stringify({
          jobId: job.id,
          target,
          source: "manual_import",
          delivery: "DRAFT",
          issueKey,
        }),
        fallbackError: "Failed to build prompt",
      }) as Promise<TailorPromptResponse>;

    let json: TailorPromptResponse;
    try {
      json = await requestPrompt(getOrCreateManualIssueKey(job.id, target));
    } catch (error) {
      const runCannotResume =
        error instanceof ApiError &&
        (error.code === "ISSUE_KEY_CONFLICT" ||
          error.code === "RUN_ALREADY_TERMINAL" ||
          error.code === "PROMPT_CONFLICT");
      if (!runCannotResume) throw error;

      // The stable key is bound to its original snapshots and terminal run.
      // Rotate only when that operation cannot accept new output; transport
      // retries continue to reuse the existing key and receipt.
      clearManualIssueKey(job.id, target);
      json = await requestPrompt(getOrCreateManualIssueKey(job.id, target));
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
    const tailoringRun =
      typeof json.tailoringRun?.id === "string" &&
      typeof json.tailoringRun.attemptId === "string"
        ? { id: json.tailoringRun.id, attemptId: json.tailoringRun.attemptId }
        : null;
    return { promptText: fullPromptText, shortPromptText, promptMeta, tailoringRun };
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
    setExternalTailoringRun(null);
    setExternalSkillPackFresh(false);
    setExternalSkillPackLocale(
      marketStringToResumeLocale(job.market ?? "AU"),
    );
    setPromptCopied(false);
    setError(null);
    setExternalPromptLoading(true);
    try {
      const { promptText, shortPromptText, promptMeta, tailoringRun } =
        await loadTailorPrompt(job, target);
      setExternalPromptText(promptText);
      setExternalShortPromptText(shortPromptText);
      setExternalPromptMeta(promptMeta);
      setExternalTailoringRun(tailoringRun);
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
      // A zip download, so this stays on raw `fetch` — `fetchJson` parses JSON.
      const res = await fetch(
        `/api/prompt-rules/skill-pack?locale=${encodeURIComponent(externalSkillPackLocale)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const message =
          (json as { error?: { message?: string } } | null)?.error?.message ??
          "Failed to download skill pack";
        throw new Error(message);
      }
      const blob = await res.blob();
      const generationReceiptVersion = res.headers.get(
        "x-generation-receipt-version",
      );
      if (
        externalPromptMeta.skillPackVersion &&
        generationReceiptVersion !== externalPromptMeta.skillPackVersion
      ) {
        throw new Error(
          "The downloaded skill pack does not match the current resume/rules receipt. Refresh and try again.",
        );
      }
      const fallbackName = "joblit-skills-v3.zip";
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
        tailoringRun: externalTailoringRun,
        source: "manual_import",
      });
      clearManualIssueKey(job.id, target);
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
    externalTailoringRun,
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
