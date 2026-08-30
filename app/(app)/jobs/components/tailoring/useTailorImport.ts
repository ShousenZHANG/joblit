"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import type { JobItem } from "../../types";
import { getErrorMessage } from "../../types";
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

/**
 * Persist one generated document as a DRAFT.
 *
 * No `promptMeta` travels with it. That field let the server check a pasted
 * answer against the prompt it had issued — a guard against a human pasting a
 * prompt built from a resume or rule set that had since changed. Generation now
 * runs from a sidecar that reads the current profile at generation time, so
 * there is no stale prompt to catch, and sending meta from a prompt that was
 * never the one used would assert provenance the run does not have.
 */
export async function persistGeneratedDraft(input: {
  jobId: string;
  target: TailorTarget;
  modelOutput: string;
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

export interface TailorImport {
  importing: boolean;
  importError: string | null;
  clearImportError: () => void;
  /**
   * Returns the full import response, not just the id: the caller finalizes
   * immediately afterwards and needs `aiContentHash` as its CAS baseline
   * without a second round trip.
   */
  importOutput: (modelOutput: string) => Promise<ManualGenerateDraftResponse | null>;
}

/** The import half of tailoring, for one job and one document. */
export function useTailorImport({
  job,
  target,
}: {
  job: JobItem;
  target: TailorTarget;
}): TailorImport {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearImportError = useCallback(() => setImportError(null), []);

  const importOutput = useCallback(
    async (modelOutput: string): Promise<ManualGenerateDraftResponse | null> => {
      setImporting(true);
      setImportError(null);
      try {
        return await persistGeneratedDraft({
          jobId: job.id,
          target,
          modelOutput,
        });
      } catch (error) {
        if (mountedRef.current) {
          setImportError(getErrorMessage(error, "Import failed"));
        }
        return null;
      } finally {
        if (mountedRef.current) setImporting(false);
      }
    },
    [job.id, target],
  );

  return { importing, importError, clearImportError, importOutput };
}
