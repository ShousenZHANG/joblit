import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import type { JobItem, ExternalPromptMeta, CvSource, CoverSource, ResumeImportOutput, CoverImportOutput } from "../types";
import { getErrorMessage } from "../types";
import type { DialogPhase } from "../components/StepIndicator";
import { isSkillPackFresh, writeSavedSkillPackMeta } from "../utils/skillPackMeta";
import { parseTailorOutput, filenameFromDisposition } from "../utils/tailorParser";

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
  const [generateComplete, setGenerateComplete] = useState(false);
  const [successPdf, setSuccessPdf] = useState<{ url: string; filename: string } | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tailorSourceByJob, setTailorSourceByJob] = useState<
    Record<string, { cv?: CvSource; cover?: CoverSource }>
  >({});

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
    setGenerateComplete(false);
    if (successPdf?.url) URL.revokeObjectURL(successPdf.url);
    setSuccessPdf(null);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successPdf?.url, setError, toast]);

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
      className: "border-slate-200 bg-slate-50 text-slate-900 animate-in fade-in zoom-in-95",
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
    setGenerateComplete(false);
    setError(null);
    try {
      const res = await fetch("/api/applications/manual-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          target,
          modelOutput,
          promptMeta: externalPromptMeta,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const baseMessage = json?.error?.message || json?.error || "Failed to generate PDF";
        const details = Array.isArray(json?.error?.details)
          ? json.error.details.filter((item: unknown) => typeof item === "string")
          : [];
        const detailText = details.length ? ` (${details.slice(0, 2).join(" | ")})` : "";
        throw new Error(`${baseMessage}${detailText}`);
      }

      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get("content-disposition")) ||
        (target === "resume" ? "resume.pdf" : "cover-letter.pdf");
      markTaskComplete("generate_first_pdf");

      if (target === "resume") {
        setTailorSourceByJob((prev) => ({
          ...prev,
          [job.id]: { ...prev[job.id], cv: "manual_import" },
        }));
      } else {
        setTailorSourceByJob((prev) => ({
          ...prev,
          [job.id]: { ...prev[job.id], cover: "manual_import" },
        }));
      }

      setGenerateComplete(true);
      const pdfObjectUrl = URL.createObjectURL(blob);
      setSuccessPdf({ url: pdfObjectUrl, filename });
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setDialogPhase("success"), 500);

      await queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });
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
    generateComplete,
    successPdf,
    successTimerRef,
    tailorSourceByJob,
    parsedExternalOutput,
    openExternalGenerateDialog,
    copySmartPrompt,
    downloadSkillPack,
    generateFromImportedJson,
  };
}
