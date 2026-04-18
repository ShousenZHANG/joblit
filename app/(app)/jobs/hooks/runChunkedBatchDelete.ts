import { chunkArray } from "@/lib/shared/chunk";

export interface ChunkResult {
  deleted: number;
  notFound: number;
}

export interface BatchDeleteSummary {
  deleted: number;
  notFound: number;
  failedIds: string[];
  /** First error encountered. Other chunks continue regardless. */
  firstError?: Error;
}

export interface RunChunkedBatchDeleteOptions {
  ids: readonly string[];
  /** Sends one chunk to the server. Should throw on HTTP/network failure. */
  sendChunk: (idsChunk: string[]) => Promise<ChunkResult>;
  /** Items per HTTP request. Server enforces its own cap as a safety net. */
  chunkSize?: number;
  /** Called after each chunk attempt — drives progress UI. */
  onProgress?: (state: {
    completedChunks: number;
    totalChunks: number;
    deletedSoFar: number;
    failedSoFar: number;
  }) => void;
}

const DEFAULT_CHUNK_SIZE = 25;

/**
 * Orchestrates a bulk-delete user action by splitting the selection into
 * multiple smaller HTTP requests and aggregating the results.
 *
 * Why chunk:
 *   - The single-shot endpoint caps payload at 100 ids, so any selection
 *     larger than that previously surfaced as "Failed to batch delete".
 *   - Even within the cap, a 100-row delete inside one transaction can
 *     exhaust Neon's per-connection time budget on cold paths.
 *
 * Failure semantics:
 *   - One failing chunk does NOT abort the whole operation. Successful
 *     chunks are kept; failed chunks are reported via failedIds and the
 *     caller can offer a partial-success UX (toast + retry button) instead
 *     of telling the user the entire bulk op failed.
 *   - Sequential by design: parallel bursts spike Neon connection usage
 *     and produce intermittent rateLimitExceeded errors.
 */
export async function runChunkedBatchDelete(
  options: RunChunkedBatchDeleteOptions,
): Promise<BatchDeleteSummary> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunks = chunkArray(options.ids, chunkSize);
  const totalChunks = chunks.length;

  let deleted = 0;
  let notFound = 0;
  const failedIds: string[] = [];
  let firstError: Error | undefined;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const result = await options.sendChunk(chunk);
      deleted += result.deleted;
      notFound += result.notFound;
    } catch (err) {
      failedIds.push(...chunk);
      if (!firstError) {
        firstError = err instanceof Error ? err : new Error(String(err));
      }
    }
    options.onProgress?.({
      completedChunks: i + 1,
      totalChunks,
      deletedSoFar: deleted,
      failedSoFar: failedIds.length,
    });
  }

  return { deleted, notFound, failedIds, firstError };
}
