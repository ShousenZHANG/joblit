"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGuide } from "@/app/GuideContext";
import { fetchJson } from "@/lib/api/fetchJson";
import {
  tailorReviewSnapshotSchema,
  type TailorReviewSnapshot,
} from "@/lib/shared/tailorReviewSnapshot";
import type { CvSource, CoverSource, JobItem } from "../types";
import { getErrorMessage } from "../types";
import type { TailorTarget } from "../components/tailoring/tailorActions";
import type {
  TailorReviewDraft,
  TailorReviewFinalized,
} from "../components/tailoring/tailorDialogTypes";
import {
  invalidateActiveJobsQueries,
  patchGeneratedJobArtifactInJobsCache,
} from "../utils/jobsQueryCache";

export type ReviewDraftSource = "manual_import" | "ai";

/** The job and target the dialog opened for. */
export interface TailorDialogSession {
  job: JobItem;
  target: TailorTarget;
}

const LOAD_FAILED = "Saved tailoring could not be opened";

function snapshotToDraft(
  snapshot: TailorReviewSnapshot,
  source: ReviewDraftSource,
): TailorReviewDraft {
  return {
    applicationId: snapshot.applicationId,
    initialPublication: snapshot.publication,
    initialAiContent: snapshot.aiContent,
    initialAiContentHash: snapshot.aiContentHash,
    masterSkills: snapshot.masterSkills,
    resumePdfUrl: snapshot.documents.resume.pdfUrl,
    coverPdfUrl: snapshot.documents.cover.pdfUrl,
    source,
    job: {
      id: snapshot.job.id,
      title: snapshot.job.title,
      company: snapshot.job.company,
      location: snapshot.job.location,
    },
  };
}

/**
 * Own the single Jobs-page tailoring dialog.
 *
 * The dialog is one surface for one job: copy a prompt, paste the result back,
 * edit it, publish it. This hook holds only what outlives a single step — which
 * job is open, the loaded Application, and the projection back into the jobs
 * query cache once a PDF is published.
 */
export function useTailorReviewController() {
  const { markTaskComplete } = useGuide();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<TailorDialogSession | null>(null);
  const [draft, setDraft] = useState<TailorReviewDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [tailorSourceByJob, setTailorSourceByJob] = useState<
    Record<string, { cv?: CvSource; cover?: CoverSource }>
  >({});
  const loadEpochRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const abortLoad = useCallback(() => {
    loadEpochRef.current += 1;
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
  }, []);

  /**
   * Close the dialog and drop any snapshot still in flight.
   *
   * Selection can change under an open dialog through history navigation or a
   * delete that promotes the next row. A snapshot that lands after that belongs
   * to a job the user is no longer looking at, so the dialog goes with it.
   */
  const cancelTailorDialog = useCallback(() => {
    abortLoad();
    setDraftLoading(false);
    setDraftError(null);
    setSession(null);
    setDraft(null);
  }, [abortLoad]);

  useEffect(() => cancelTailorDialog, [cancelTailorDialog]);

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

  const loadDraft = useCallback(
    async (input: {
      applicationId: string;
      jobId: string;
      source: ReviewDraftSource;
    }): Promise<boolean> => {
      abortLoad();
      const controller = new AbortController();
      loadControllerRef.current = controller;
      const epoch = loadEpochRef.current;
      setDraftError(null);
      setDraftLoading(true);

      try {
        const snapshot = await fetchJson(
          `/api/applications/${encodeURIComponent(input.applicationId)}/review-snapshot`,
          {
            cache: "no-store",
            signal: controller.signal,
            fallbackError: LOAD_FAILED,
            schema: tailorReviewSnapshotSchema,
          },
        );
        if (controller.signal.aborted || epoch !== loadEpochRef.current) {
          return false;
        }
        if (snapshot.job.id !== input.jobId) {
          setDraftError("This result no longer matches the selected job.");
          return false;
        }
        markTaskComplete("generate_first_pdf");
        setDraft(snapshotToDraft(snapshot, input.source));
        return true;
      } catch (error) {
        if (controller.signal.aborted || epoch !== loadEpochRef.current) {
          return false;
        }
        setDraftError(getErrorMessage(error, LOAD_FAILED));
        return false;
      } finally {
        if (epoch === loadEpochRef.current) {
          loadControllerRef.current = null;
          setDraftLoading(false);
        }
      }
    },
    [abortLoad, markTaskComplete],
  );

  const openTailorDialog = useCallback(
    (job: JobItem, target: TailorTarget) => {
      abortLoad();
      setDraftError(null);
      setDraft(null);
      setSession({ job, target });
      if (job.applicationId) {
        void loadDraft({
          applicationId: job.applicationId,
          jobId: job.id,
          source: "ai",
        });
      }
    },
    [abortLoad, loadDraft],
  );

  const handleFinalized = useCallback(
    (result: TailorReviewFinalized) => {
      const jobId = session?.job.id;
      if (!jobId) return;
      rememberSource(jobId, result.target, draft?.source ?? "ai");
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
    [draft, queryClient, rememberSource, session],
  );

  const handleImported = useCallback(
    async (input: {
      applicationId: string;
      jobId: string;
      target: TailorTarget;
    }): Promise<boolean> => {
      markTaskComplete("generate_first_pdf");
      rememberSource(input.jobId, input.target, "manual_import");
      void invalidateActiveJobsQueries(queryClient);
      // The import response carries the Application but not the candidate's
      // skill bank, and the review panel cannot name a single selected skill
      // without it. Re-reading the snapshot is one request that also settles
      // the CAS baseline the editor is about to autosave against.
      return loadDraft({
        applicationId: input.applicationId,
        jobId: input.jobId,
        source: "manual_import",
      });
    },
    [loadDraft, markTaskComplete, queryClient, rememberSource],
  );

  return {
    session,
    draft,
    draftLoading,
    draftError,
    tailorSourceByJob,
    openTailorDialog,
    cancelTailorDialog,
    handleImported,
    handleFinalized,
  };
}
