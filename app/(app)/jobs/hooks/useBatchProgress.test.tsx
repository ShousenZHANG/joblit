import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBatchProgress } from "./useBatchProgress";

const BATCH_ID = "22222222-2222-2222-2222-222222222222";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useBatchProgress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds a newly-created batch immediately without waiting for latest discovery", async () => {
    let resolveLatest!: (response: Response) => void;
    const latest = new Promise<Response>((resolve) => {
      resolveLatest = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/application-batches/latest")) return latest;
      if (url === `/api/application-batches/${BATCH_ID}/summary`) {
        return json({
          batch: { id: BATCH_ID, status: "QUEUED", totalCount: 8 },
          progress: {
            pending: 8,
            running: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
          },
          succeeded: [],
          failed: [],
        });
      }
      return json({ error: "not mocked" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useBatchProgress({ onJobsSettled: vi.fn() }),
    );

    act(() => {
      result.current.watchBatch({
        id: BATCH_ID,
        status: "QUEUED",
        totalCount: 8,
      });
    });

    expect(result.current.state).toMatchObject({
      batchId: BATCH_ID,
      status: "QUEUED",
      total: 8,
      pending: 8,
      active: true,
    });

    resolveLatest(json({ batchId: null, status: null }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/application-batches/${BATCH_ID}/summary`,
        expect.anything(),
      ),
    );
  });
});
