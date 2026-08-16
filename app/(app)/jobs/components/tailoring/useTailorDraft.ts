"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, ApiError } from "@/lib/api/fetchJson";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import {
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import {
  tailorDraftCommitSchema,
} from "./tailorResponseSchemas";

export type SaveStatus =
  | { kind: "saved"; at: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string; conflict?: boolean };

interface UseTailorDraftOptions {
  applicationId: string;
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  initialPublication: ApplicationPublication;
  onCommitted?: (commit: TailorDraftCommit) => void;
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

/**
 * The in-memory baseline may be null for a legacy row opened before its first
 * v2 save. Successful draft/discard responses are stricter at the network
 * boundary and always advance this to a non-null CAS hash.
 */
export interface TailorDraftCommit {
  aiContentHash: string | null;
  publication: ApplicationPublication;
}

interface UseTailorDraftReturn {
  aiContent: AiContent;
  setAiContent: (next: AiContent) => void;
  saveStatus: SaveStatus;
  /** Trigger an immediate flush of pending changes (e.g. before Finalize). */
  flushNow: () => Promise<TailorDraftCommit>;
  /** Replace state from server (e.g. after Discard). */
  replaceFromServer: (next: AiContent, commit: TailorDraftCommit) => void;
  /** Advance the authoritative CAS/publication after a server-side finalize. */
  acceptServerCommit: (commit: TailorDraftCommit) => void;
  currentHash: string | null;
  publication: ApplicationPublication;
}

export function useTailorDraft({
  applicationId,
  initialAiContent,
  initialAiContentHash,
  initialPublication,
  onCommitted,
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
  const [publication, setPublication] =
    useState<ApplicationPublication>(initialPublication);
  const aiContentRef = useRef<AiContent>(initialAiContent);
  const lastSavedCommitRef = useRef<TailorDraftCommit>({
    aiContentHash: initialAiContentHash,
    publication: initialPublication,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<TailorDraftCommit> | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const lastSaveErrorRef = useRef<{ version: number; error: Error } | null>(
    null,
  );

  const persist = useCallback(
    async (
      snapshot: AiContent,
      version: number,
    ): Promise<TailorDraftCommit> => {
      const expectedHash = lastSavedCommitRef.current.aiContentHash;
      setSaveStatus({ kind: "saving" });
      try {
        const json = await fetchJson(
          `/api/applications/${applicationId}/draft`,
          {
            method: "PATCH",
            body: JSON.stringify({
              aiContent: snapshot,
              expectedHash,
            }),
            schema: tailorDraftCommitSchema,
          },
        );
        lastSaveErrorRef.current = null;
        lastSavedCommitRef.current = json;
        setCurrentHash(json.aiContentHash);
        if (version === versionRef.current) {
          savedVersionRef.current = version;
          setPublication(json.publication);
          onCommitted?.(json);
          setSaveStatus({ kind: "saved", at: Date.now() });
        } else {
          setSaveStatus({ kind: "dirty" });
        }
        return json;
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 409) {
          const error = new Error(conflictMessage);
          lastSaveErrorRef.current = { version, error };
          setSaveStatus({
            kind: "error",
            message: error.message,
            conflict: true,
          });
          return lastSavedCommitRef.current;
        }
        const message =
          err instanceof Error ? err.message : saveFailedMessage;
        lastSaveErrorRef.current = {
          version,
          error: err instanceof Error ? err : new Error(message),
        };
        setSaveStatus({ kind: "error", message });
        return lastSavedCommitRef.current;
      }
    },
    [applicationId, conflictMessage, onCommitted, saveFailedMessage],
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

    while (savedVersionRef.current !== versionRef.current) {
      const activeSave = inFlightRef.current;
      if (activeSave) {
        await activeSave;
        if (savedVersionRef.current === versionRef.current) {
          return lastSavedCommitRef.current;
        }
        const activeFailure = lastSaveErrorRef.current;
        if (activeFailure?.version === versionRef.current) {
          throw activeFailure.error;
        }
        continue;
      }

      const version = versionRef.current;
      await startPersist(aiContentRef.current, version);
      if (savedVersionRef.current === versionRef.current) {
        return lastSavedCommitRef.current;
      }
      const failure = lastSaveErrorRef.current;
      if (failure?.version === version && versionRef.current === version) {
        throw failure.error;
      }
    }

    return lastSavedCommitRef.current;
  }, [startPersist]);

  const replaceFromServer = useCallback(
    (next: AiContent, commit: TailorDraftCommit) => {
      const resolvedCommit = {
        ...commit,
        aiContentHash: commit.aiContentHash ?? hashAiContent(next),
      };
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      versionRef.current += 1;
      savedVersionRef.current = versionRef.current;
      lastSaveErrorRef.current = null;
      aiContentRef.current = next;
      setAiContentState(next);
      lastSavedCommitRef.current = resolvedCommit;
      setCurrentHash(resolvedCommit.aiContentHash);
      setPublication(resolvedCommit.publication);
      onCommitted?.(resolvedCommit);
      setSaveStatus({ kind: "saved", at: Date.now() });
    },
    [onCommitted],
  );

  const acceptServerCommit = useCallback(
    (commit: TailorDraftCommit) => {
      lastSaveErrorRef.current = null;
      savedVersionRef.current = versionRef.current;
      lastSavedCommitRef.current = commit;
      setCurrentHash(commit.aiContentHash);
      setPublication(commit.publication);
      onCommitted?.(commit);
      setSaveStatus({ kind: "saved", at: Date.now() });
    },
    [onCommitted],
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
    acceptServerCommit,
    currentHash,
    publication,
  };
}
