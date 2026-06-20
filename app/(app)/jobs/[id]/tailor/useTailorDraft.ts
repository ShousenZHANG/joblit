"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, ApiError } from "@/lib/api/fetchJson";
import {
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

export type SaveStatus =
  | { kind: "saved"; at: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string; conflict?: boolean };

export interface UseTailorDraftOptions {
  applicationId: string;
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  /** Debounce window for autosave, ms. */
  debounceMs?: number;
  /** Localized message shown when another tab updated the draft (409). */
  conflictMessage?: string;
  /** Localized fallback message shown when a save fails. */
  saveFailedMessage?: string;
}

const DEFAULT_CONFLICT_MESSAGE =
  "Another tab updated this draft. Reload to continue.";
const DEFAULT_SAVE_FAILED_MESSAGE = "Save failed — retry";

export interface UseTailorDraftReturn {
  aiContent: AiContent;
  setAiContent: (next: AiContent) => void;
  saveStatus: SaveStatus;
  /** Trigger an immediate flush of pending changes (e.g. before Finalize). */
  flushNow: () => Promise<string | null>;
  /** Replace state from server (e.g. after Discard). */
  replaceFromServer: (next: AiContent, hash: string | null) => void;
  currentHash: string | null;
}

export function useTailorDraft({
  applicationId,
  initialAiContent,
  initialAiContentHash,
  debounceMs = 2000,
  conflictMessage = DEFAULT_CONFLICT_MESSAGE,
  saveFailedMessage = DEFAULT_SAVE_FAILED_MESSAGE,
}: UseTailorDraftOptions): UseTailorDraftReturn {
  const [aiContent, setAiContentState] = useState<AiContent>(initialAiContent);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => ({
    kind: "saved" as const,
    at: Date.now(),
  }));
  const [currentHash, setCurrentHash] = useState<string | null>(initialAiContentHash);
  const aiContentRef = useRef<AiContent>(initialAiContent);
  const lastSavedHashRef = useRef<string | null>(initialAiContentHash);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);

  const persist = useCallback(
    async (snapshot: AiContent, version: number): Promise<string | null> => {
      const expectedHash = lastSavedHashRef.current;
      setSaveStatus({ kind: "saving" });
      try {
        const res = await fetchJson<undefined>(
          `/api/applications/${applicationId}/draft`,
          {
            method: "PATCH",
            body: JSON.stringify({
              aiContent: snapshot,
              expectedHash,
            }),
          },
        );
        const json = res as { aiContentHash: string };
        lastSavedHashRef.current = json.aiContentHash;
        setCurrentHash(json.aiContentHash);
        if (version === versionRef.current) {
          savedVersionRef.current = version;
          setSaveStatus({ kind: "saved", at: Date.now() });
        } else {
          setSaveStatus({ kind: "dirty" });
        }
        return json.aiContentHash;
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 409) {
          setSaveStatus({
            kind: "error",
            message: conflictMessage,
            conflict: true,
          });
          return lastSavedHashRef.current;
        }
        const message =
          err instanceof Error ? err.message : saveFailedMessage;
        setSaveStatus({ kind: "error", message });
        return lastSavedHashRef.current;
      }
    },
    [applicationId, conflictMessage, saveFailedMessage],
  );

  const startPersist = useCallback(
    (snapshot: AiContent, version: number) => {
      const previousSave = inFlightRef.current;
      const promise = (async () => {
        if (previousSave) {
          await previousSave;
        }
        return persist(snapshot, version);
      })();
      inFlightRef.current = promise;
      void promise.finally(() => {
        if (inFlightRef.current === promise) {
          inFlightRef.current = null;
        }
      });
      return promise;
    },
    [persist],
  );

  const setAiContent = useCallback(
    (next: AiContent) => {
      const nextVersion = versionRef.current + 1;
      versionRef.current = nextVersion;
      aiContentRef.current = next;
      setAiContentState(next);
      setSaveStatus({ kind: "dirty" });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const localSnapshot = next;
        void startPersist(localSnapshot, nextVersion);
      }, debounceMs);
    },
    [debounceMs, startPersist],
  );

  const flushNow = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (savedVersionRef.current === versionRef.current) {
      return lastSavedHashRef.current;
    }
    const activeSave = inFlightRef.current;
    if (activeSave) {
      await activeSave;
      if (savedVersionRef.current === versionRef.current) {
        return lastSavedHashRef.current;
      }
    }
    return startPersist(aiContentRef.current, versionRef.current);
  }, [startPersist]);

  const replaceFromServer = useCallback(
    (next: AiContent, hash: string | null) => {
      const resolvedHash = hash ?? hashAiContent(next);
      versionRef.current += 1;
      savedVersionRef.current = versionRef.current;
      aiContentRef.current = next;
      setAiContentState(next);
      lastSavedHashRef.current = resolvedHash;
      setCurrentHash(resolvedHash);
      setSaveStatus({ kind: "saved", at: Date.now() });
    },
    [],
  );

  // Cleanup pending timer on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return {
    aiContent,
    setAiContent,
    saveStatus,
    flushNow,
    replaceFromServer,
    currentHash,
  };
}
