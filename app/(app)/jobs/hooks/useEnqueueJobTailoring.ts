"use client";

import { useCallback, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";

export type EnqueueResponse = {
  batchId: string;
  /** Task count of the batch after this call, for seeding the progress UI. */
  totalCount: number;
  queuedCount: number;
  queuedJobIds: string[];
  alreadyQueuedJobIds: string[];
  ineligibleJobIds: string[];
};

/**
 * Put one Job into the tailoring queue and report which Job is in flight.
 *
 * The pending id is tracked per Job rather than as a single boolean: two rows
 * can be asked for in quick succession, and a shared flag would spin both
 * buttons while only one request existed.
 */
export function useEnqueueJobTailoring(input: {
  onQueued: (result: EnqueueResponse) => void;
  onError: (message: string, code: string | null) => void;
  fallbackErrorMessage: string;
}) {
  const { onQueued, onError, fallbackErrorMessage } = input;
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  const enqueueJob = useCallback(
    async (jobId: string) => {
      if (pendingJobId) return;
      setPendingJobId(jobId);
      try {
        const result = (await fetchJson("/api/application-batches/enqueue", {
          method: "POST",
          body: JSON.stringify({ jobIds: [jobId] }),
        })) as EnqueueResponse;
        onQueued(result);
      } catch (error) {
        const code = error instanceof ApiError ? (error.code ?? null) : null;
        const message =
          error instanceof ApiError && error.message
            ? error.message
            : fallbackErrorMessage;
        onError(message, code);
      } finally {
        setPendingJobId(null);
      }
    },
    [fallbackErrorMessage, onError, onQueued, pendingJobId],
  );

  return { enqueueJob, pendingJobId };
}
