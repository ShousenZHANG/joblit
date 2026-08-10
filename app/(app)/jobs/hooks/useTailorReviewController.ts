"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGuide } from "@/app/GuideContext";
import { fetchJson } from "@/lib/api/fetchJson";
import {
  applicationReviewSnapshotSchema,
  type ApplicationReviewSnapshot,
} from "@/lib/shared/schemas/applicationReviewSnapshot";
import type { CvSource, CoverSource } from "../types";
import { getErrorMessage } from "../types";
import type {
  TailorReviewDraft,
  TailorReviewFinalized,
} from "../components/TailorReviewDialog";
import type { TailorTarget } from "../[id]/tailor/tailorActions";
import type { ManualGenerateDraftResponse } from "./manualGenerateDraftResponse";
import {
  invalidateActiveJobsQueries,
  patchGeneratedJobArtifactInJobsCache,
} from "../utils/jobsQueryCache";

export type ReviewDraftSource = "manual_import" | "ai";
export type ApplicationReviewLoad = {
  applicationId: string;
  jobId: string;
  target: TailorTarget;
};

function snapshotToDraft(
  snapshot: ApplicationReviewSnapshot,
  target: TailorTarget,
): TailorReviewDraft {
  return {
    applicationId: snapshot.applicationId,
    target,
    initialPublication: snapshot.publication,
    initialAiContent: snapshot.aiContent,
    initialAiContentHash: snapshot.aiContentHash,
    resumePdfUrl: snapshot.documents.resume.pdfUrl,
    coverPdfUrl: snapshot.documents.cover.pdfUrl,
    pdfName: snapshot.documents[target].pdfName,
    source: "ai",
    job: {
      id: snapshot.job.id,
      title: snapshot.job.title,
      company: snapshot.job.company,
      location: snapshot.job.location,
    },
  };
}

/**
 * Own the single Jobs-page tailoring editor session.
 *
 * Manual imports and completed Runner batches enter through different read
 * seams, but everything after this boundary shares the same autosave, preview,
 * conflict detection, Finalize flow, and query-cache projection.
 */
export function useTailorReviewController() {
  const { markTaskComplete } = useGuide();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TailorReviewDraft | null>(null);
  const [loading, setLoading] = useState<ApplicationReviewLoad | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorFor, setLoadErrorFor] =
    useState<ApplicationReviewLoad | null>(null);
  const [tailorSourceByJob, setTailorSourceByJob] = useState<
    Record<string, { cv?: CvSource; cover?: CoverSource }>
  >({});
  const loadEpochRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const cancelApplicationReviewLoad = useCallback(() => {
    loadEpochRef.current += 1;
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    setLoading(null);
    setLoadError(null);
    setLoadErrorFor(null);
  }, []);

  useEffect(() => cancelApplicationReviewLoad, [cancelApplicationReviewLoad]);

  const rememberSource = useCallback(
    (jobId: string | null, target: TailorTarget, source: ReviewDraftSource) => {
      if (!jobId) return;
      setTailorSourceByJob((previous) => ({
        ...previous,
        [jobId]: {
          ...previous[jobId],
          ...(target === "resume"
            ? { cv: source as CvSource }
            : { cover: source as CoverSource }),
        },
      }));
    },
    [],
  );

  const openPersistedDraft = useCallback(
    (input: {
      draft: ManualGenerateDraftResponse;
      target: TailorTarget;
      source: "manual_import";
      resumePdfUrl?: string | null;
      coverPdfUrl?: string | null;
    }) => {
      cancelApplicationReviewLoad();
      markTaskComplete("generate_first_pdf");
      rememberSource(input.draft.job.id, input.target, input.source);
      setDraft({
        applicationId: input.draft.applicationId,
        target: input.target,
        initialPublication: input.draft.publication,
        initialAiContent: input.draft.aiContent,
        initialAiContentHash: input.draft.aiContentHash,
        resumePdfUrl: input.resumePdfUrl ?? null,
        coverPdfUrl: input.coverPdfUrl ?? null,
        pdfName: input.draft.pdfName,
        source: input.source,
        job: input.draft.job,
      });
      void invalidateActiveJobsQueries(queryClient);
    },
    [
      cancelApplicationReviewLoad,
      markTaskComplete,
      queryClient,
      rememberSource,
    ],
  );

  const openApplicationReview = useCallback(
    async (input: ApplicationReviewLoad): Promise<boolean> => {
      loadControllerRef.current?.abort();
      const controller = new AbortController();
      loadControllerRef.current = controller;
      const epoch = ++loadEpochRef.current;
      setLoadError(null);
      setLoadErrorFor(null);
      setLoading(input);

      try {
        const snapshot = await fetchJson(
          `/api/applications/${encodeURIComponent(input.applicationId)}/review-snapshot`,
          {
            cache: "no-store",
            signal: controller.signal,
            fallbackError: "Review & Edit is not available yet",
            schema: applicationReviewSnapshotSchema,
          },
        );
        if (controller.signal.aborted || epoch !== loadEpochRef.current) {
          return false;
        }
        if (snapshot.job.id !== input.jobId) {
          setLoadError("This result no longer matches the selected job.");
          setLoadErrorFor(input);
          return false;
        }
        markTaskComplete("generate_first_pdf");
        rememberSource(snapshot.job.id, input.target, "ai");
        setDraft(snapshotToDraft(snapshot, input.target));
        return true;
      } catch (error) {
        if (controller.signal.aborted || epoch !== loadEpochRef.current) {
          return false;
        }
        setLoadError(
          getErrorMessage(error, "Review & Edit is not available yet"),
        );
        setLoadErrorFor(input);
        return false;
      } finally {
        if (epoch === loadEpochRef.current) {
          loadControllerRef.current = null;
          setLoading(null);
        }
      }
    },
    [markTaskComplete, rememberSource],
  );

  const closeReview = useCallback(() => setDraft(null), []);

  const handleFinalized = useCallback(
    (result: TailorReviewFinalized) => {
      const jobId = draft?.job.id;
      if (!jobId) return;
      const source = draft.source ?? "ai";
      rememberSource(jobId, result.target, source);
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
    },
    [draft, queryClient, rememberSource],
  );

  return {
    draft,
    loading,
    loadError,
    loadErrorFor,
    tailorSourceByJob,
    openPersistedDraft,
    openApplicationReview,
    cancelApplicationReviewLoad,
    closeReview,
    handleFinalized,
  };
}
