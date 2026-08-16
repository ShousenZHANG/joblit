"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { useToast } from "@/hooks/use-toast";
import { marketStringToResumeLocale } from "@/lib/shared/market";
import type { ExternalPromptMeta, JobItem } from "../../types";
import { getErrorMessage } from "../../types";
import {
  isSkillPackFresh,
  writeSavedSkillPackMeta,
} from "../../utils/skillPackMeta";
import { filenameFromDisposition } from "../../utils/tailorParser";
import {
  manualGenerateDraftResponseSchema,
  type ManualGenerateDraftResponse,
} from "../../hooks/manualGenerateDraftResponse";
import type { TailorTarget } from "./tailorActions";

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

export async function persistGeneratedDraft(input: {
  jobId: string;
  target: TailorTarget;
  modelOutput: string;
  promptMeta?: ExternalPromptMeta | null;
}): Promise<ManualGenerateDraftResponse> {
  try {
    return await fetchJson("/api/applications/manual-generate?finalize=false", {
      method: "POST",
      body: JSON.stringify({ ...input, source: "manual_import" }),
      fallbackError: "Failed to import generated content",
      schema: manualGenerateDraftResponseSchema,
    });
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
}

export interface TailorPromptState {
  loading: boolean;
  text: string;
  shortText: string;
  meta: ExternalPromptMeta | null;
  error: string | null;
}

export interface TailorGeneration {
  prompt: TailorPromptState;
  copied: boolean;
  copyPrompt: () => Promise<void>;
  skillPackFresh: boolean;
  skillPackLoading: boolean;
  downloadSkillPack: () => Promise<void>;
  importing: boolean;
  importError: string | null;
  clearImportError: () => void;
  importOutput: (modelOutput: string) => Promise<string | null>;
}

const EMPTY_PROMPT: TailorPromptState = {
  loading: true,
  text: "",
  shortText: "",
  meta: null,
  error: null,
};

type PromptCache = Partial<Record<TailorTarget, TailorPromptState>>;

interface TailorPromptPayload {
  promptText: string;
  shortPromptText: string;
  promptMeta: ExternalPromptMeta | null;
}

async function loadTailorPrompt(
  jobId: string,
  target: TailorTarget,
): Promise<TailorPromptPayload> {
  type TailorPromptResponse = {
    prompt?: { systemPrompt?: string; userPrompt?: string; shortUserPrompt?: string };
    promptMeta?: Record<string, unknown>;
  };
  const json = (await fetchJson("/api/applications/prompt", {
    method: "POST",
    body: JSON.stringify({ jobId, target }),
    fallbackError: "Failed to build prompt",
  })) as TailorPromptResponse;
  const promptText = [
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
  const short = json.prompt?.shortUserPrompt;
  const shortPromptText =
    typeof short === "string" && short.trim().length > 0
      ? [
          "Follow your loaded joblit-tailoring pack. Output exactly one JSON object (no markdown or code fences).",
          "",
          short,
        ].join("\n")
      : promptText;
  return { promptText, shortPromptText, promptMeta: readPromptMeta(json.promptMeta) };
}

function readPromptMeta(
  value: Record<string, unknown> | undefined,
): ExternalPromptMeta | null {
  if (
    !value ||
    typeof value.ruleSetId !== "string" ||
    typeof value.resumeSnapshotUpdatedAt !== "string"
  ) {
    return null;
  }
  const optional = (key: string) =>
    typeof value[key] === "string" ? (value[key] as string) : undefined;
  return {
    ruleSetId: value.ruleSetId,
    resumeSnapshotUpdatedAt: value.resumeSnapshotUpdatedAt,
    promptTemplateVersion: optional("promptTemplateVersion"),
    schemaVersion: optional("schemaVersion"),
    skillPackVersion: optional("skillPackVersion"),
    promptHash: optional("promptHash"),
  };
}

/**
 * The copy-prompt / paste-result half of tailoring, for one job and one target.
 *
 * Prompts are cached per target because switching tabs to compare the two
 * documents is a normal move, and re-issuing a prompt on every switch would
 * make the Copy button flicker back to a loading state each time.
 */
export function useTailorGeneration({
  job,
  target,
}: {
  job: JobItem;
  target: TailorTarget;
}): TailorGeneration {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<PromptCache>({});
  const [copiedTarget, setCopiedTarget] = useState<TailorTarget | null>(null);
  const [skillPackFresh, setSkillPackFresh] = useState(false);
  const [skillPackLoading, setSkillPackLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const prompt = prompts[target] ?? EMPTY_PROMPT;
  const loaded = Boolean(prompts[target]);

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadTailorPrompt(job.id, target);
        if (cancelled) return;
        setPrompts((current) => ({
          ...current,
          [target]: {
            loading: false,
            text: payload.promptText,
            shortText: payload.shortPromptText,
            meta: payload.promptMeta,
            error: null,
          },
        }));
        setSkillPackFresh(isSkillPackFresh(payload.promptMeta));
      } catch (error) {
        if (cancelled) return;
        setPrompts((current) => ({
          ...current,
          [target]: {
            ...EMPTY_PROMPT,
            loading: false,
            error: getErrorMessage(error, "Failed to build prompt"),
          },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id, loaded, target]);

  const copyPrompt = useCallback(async () => {
    const text =
      skillPackFresh && prompt.shortText.trim() ? prompt.shortText : prompt.text;
    if (!text.trim()) return;
    let downloaded = false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // No clipboard (insecure origin, or a browser that withholds it): hand
      // the user a file they can open and copy from rather than nothing.
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "joblit-tailor-prompt.txt";
      anchor.click();
      URL.revokeObjectURL(url);
      downloaded = true;
    }
    if (!mountedRef.current) return;
    setCopiedTarget(target);
    setTimeout(() => {
      if (mountedRef.current) setCopiedTarget(null);
    }, 2500);
    if (downloaded) {
      toast({
        title: "Prompt downloaded",
        description: "Clipboard unavailable. Open the file and paste into your AI.",
        duration: 2200,
      });
    }
  }, [prompt.shortText, prompt.text, skillPackFresh, target, toast]);

  const downloadSkillPack = useCallback(async () => {
    if (prompt.loading || skillPackLoading) return;
    const meta = prompt.meta;
    if (!meta) return;
    setSkillPackLoading(true);
    try {
      const locale = marketStringToResumeLocale(job.market ?? "AU");
      // A zip download, so this stays on raw `fetch` — `fetchJson` parses JSON.
      const res = await fetch(
        `/api/prompt-rules/skill-pack?locale=${encodeURIComponent(locale)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(json?.error?.message ?? "Failed to download skill pack");
      }
      const blob = await res.blob();
      if (
        meta.skillPackVersion &&
        res.headers.get("x-generation-receipt-version") !== meta.skillPackVersion
      ) {
        throw new Error(
          "The downloaded skill pack does not match the current resume/rules receipt. Refresh and try again.",
        );
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download =
        filenameFromDisposition(res.headers.get("content-disposition")) ||
        "joblit-skills-v3.zip";
      link.click();
      URL.revokeObjectURL(objectUrl);
      writeSavedSkillPackMeta(meta);
      if (mountedRef.current) setSkillPackFresh(true);
    } catch (error) {
      toast({
        title: "Download failed",
        description: getErrorMessage(error, "Failed to download skill pack"),
        variant: "destructive",
        duration: 2600,
      });
    } finally {
      if (mountedRef.current) setSkillPackLoading(false);
    }
  }, [job.market, prompt.loading, prompt.meta, skillPackLoading, toast]);

  const clearImportError = useCallback(() => setImportError(null), []);

  const importOutput = useCallback(
    async (modelOutput: string): Promise<string | null> => {
      setImporting(true);
      setImportError(null);
      try {
        const draft = await persistGeneratedDraft({
          jobId: job.id,
          target,
          modelOutput,
          promptMeta: prompt.meta,
        });
        return draft.applicationId;
      } catch (error) {
        if (mountedRef.current) {
          setImportError(getErrorMessage(error, "Import failed"));
        }
        return null;
      } finally {
        if (mountedRef.current) setImporting(false);
      }
    },
    [job.id, prompt.meta, target],
  );

  return {
    prompt,
    copied: copiedTarget === target,
    copyPrompt,
    skillPackFresh,
    skillPackLoading,
    downloadSkillPack,
    importing,
    importError,
    clearImportError,
    importOutput,
  };
}
