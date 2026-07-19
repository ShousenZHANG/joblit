import { describe, it, expect, vi } from "vitest";
import { runChunkedBatchDelete } from "./runChunkedBatchDelete";

describe("runChunkedBatchDelete", () => {
  it("splits ids into chunks of the requested size", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `id-${i}`);
    const calls: string[][] = [];
    await runChunkedBatchDelete({
      ids,
      chunkSize: 3,
      sendChunk: async (chunk) => {
        calls.push([...chunk]);
        return { deleted: chunk.length, notFound: 0 };
      },
    });
    expect(calls).toEqual([
      ["id-0", "id-1", "id-2"],
      ["id-3", "id-4", "id-5"],
      ["id-6"],
    ]);
  });

  it("aggregates deleted and notFound counts across chunks", async () => {
    const summary = await runChunkedBatchDelete({
      ids: ["a", "b", "c", "d"],
      chunkSize: 2,
      sendChunk: async () => ({ deleted: 1, notFound: 1 }),
    });
    expect(summary.deleted).toBe(2);
    expect(summary.notFound).toBe(2);
    expect(summary.completedIds).toEqual(["a", "b", "c", "d"]);
    expect(summary.failedIds).toEqual([]);
    expect(summary.firstError).toBeUndefined();
  });

  it("continues after a chunk fails and reports the failed ids", async () => {
    const sendChunk = vi
      .fn<(chunk: string[]) => Promise<{ deleted: number; notFound: number }>>()
      .mockResolvedValueOnce({ deleted: 2, notFound: 0 }) // chunk 1 ok
      .mockRejectedValueOnce(new Error("boom")) // chunk 2 fail
      .mockResolvedValueOnce({ deleted: 1, notFound: 0 }); // chunk 3 ok
    const summary = await runChunkedBatchDelete({
      ids: ["a", "b", "c", "d", "e"],
      chunkSize: 2,
      sendChunk,
    });
    expect(sendChunk).toHaveBeenCalledTimes(3);
    expect(summary.deleted).toBe(3);
    expect(summary.completedIds).toEqual(["a", "b", "e"]);
    expect(summary.failedIds).toEqual(["c", "d"]);
    expect(summary.firstError?.message).toBe("boom");
  });

  it("only records the first error when multiple chunks fail", async () => {
    const sendChunk = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"));
    const summary = await runChunkedBatchDelete({
      ids: ["a", "b"],
      chunkSize: 1,
      sendChunk,
    });
    expect(summary.firstError?.message).toBe("first");
    expect(summary.failedIds).toEqual(["a", "b"]);
  });

  it("fires onProgress after each chunk with running totals", async () => {
    const progressCalls: Array<{
      completedChunks: number;
      totalChunks: number;
      deletedSoFar: number;
      failedSoFar: number;
    }> = [];
    await runChunkedBatchDelete({
      ids: ["a", "b", "c", "d"],
      chunkSize: 2,
      sendChunk: async (chunk) => ({ deleted: chunk.length, notFound: 0 }),
      onProgress: (state) => progressCalls.push(state),
    });
    expect(progressCalls).toEqual([
      { completedChunks: 1, totalChunks: 2, deletedSoFar: 2, failedSoFar: 0 },
      { completedChunks: 2, totalChunks: 2, deletedSoFar: 4, failedSoFar: 0 },
    ]);
  });

  it("processes chunks sequentially (never in parallel)", async () => {
    let inflight = 0;
    let maxInflight = 0;
    await runChunkedBatchDelete({
      ids: Array.from({ length: 6 }, (_, i) => `id-${i}`),
      chunkSize: 2,
      sendChunk: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return { deleted: 2, notFound: 0 };
      },
    });
    expect(maxInflight).toBe(1);
  });

  it("handles empty input as a no-op", async () => {
    const sendChunk = vi.fn();
    const summary = await runChunkedBatchDelete({
      ids: [],
      sendChunk,
    });
    expect(sendChunk).not.toHaveBeenCalled();
    expect(summary).toEqual({
      deleted: 0,
      notFound: 0,
      completedIds: [],
      failedIds: [],
      firstError: undefined,
    });
  });
});
