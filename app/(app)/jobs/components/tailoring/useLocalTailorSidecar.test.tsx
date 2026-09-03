import { act, renderHook, waitFor } from "@testing-library/react";
import { ReadableStream } from "node:stream/web";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLocalTailorSidecar } from "./useLocalTailorSidecar";

/**
 * Serves an NDJSON body the way the sidecar does: one event per line.
 *
 * jsdom has no `ReadableStream`, so this borrows Node's — the hook only ever
 * calls `getReader()`, which both implementations share.
 */
function streamOf(events: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const AI_CONTENT = { cv: { summary: { aiText: "Tailored." } } };
const RAW_OUTPUT = '{ "cvSummary": "Tailored.", "skillsSelection": [] }';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLocalTailorSidecar", () => {
  // The import boundary parses the RAW model shape, so the hook must hand back
  // the exact bytes the sidecar's gate accepted — not the derived aggregate.
  it("returns the raw accepted output and reports progress along the way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamOf([
          { phase: "prompt", chars: 20000, job: "AI Engineer" },
          { phase: "generate", attempt: 1, of: 3 },
          {
            phase: "done",
            ok: true,
            attempts: 1,
            rawOutput: RAW_OUTPUT,
            aiContent: AI_CONTENT,
          },
        ]),
      ),
    );

    const { result } = renderHook(() => useLocalTailorSidecar());
    let generated: string | null = null;
    await act(async () => {
      generated = await result.current.generate({ jobId: "job-1", target: "resume" });
    });

    expect(generated).toBe(RAW_OUTPUT);
    expect(result.current.error).toBeNull();
    expect(result.current.running).toBe(false);
  });

  // A sidecar older than the rawOutput field still answers; falling back to
  // the aggregate keeps the failure visible at import rather than silent here.
  it("falls back to the aggregate when an old sidecar omits rawOutput", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamOf([{ phase: "done", ok: true, attempts: 1, aiContent: AI_CONTENT }]),
      ),
    );

    const { result } = renderHook(() => useLocalTailorSidecar());
    let generated: string | null = null;
    await act(async () => {
      generated = await result.current.generate({ jobId: "job-1", target: "resume" });
    });

    expect(generated).toBe(JSON.stringify(AI_CONTENT, null, 2));
  });

  it("surfaces the last gate rejection when the loop gives up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamOf([
          { phase: "generate", attempt: 1, of: 3 },
          {
            phase: "rejected",
            attempt: 1,
            code: "SUMMARY_UNGROUNDED_NUMBER",
            message: 'The summary claims "12".',
          },
          {
            phase: "done",
            ok: false,
            attempts: 2,
            note: "stalled",
            rejections: [
              { code: "SUMMARY_UNGROUNDED_NUMBER", message: 'The summary claims "12".' },
            ],
          },
        ]),
      ),
    );

    const { result } = renderHook(() => useLocalTailorSidecar());
    let generated: string | null = "unset";
    await act(async () => {
      generated = await result.current.generate({ jobId: "job-1", target: "resume" });
    });

    expect(generated).toBeNull();
    expect(result.current.error).toContain("SUMMARY_UNGROUNDED_NUMBER");
    expect(result.current.offline).toBe(false);
  });

  // The sidecar is a process someone has to start, so "not running" is an
  // ordinary state that needs its own instruction — not a generic failure.
  it("flags an unreachable sidecar separately from a failed generation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { result } = renderHook(() => useLocalTailorSidecar());
    await act(async () => {
      await result.current.generate({ jobId: "job-1", target: "resume" });
    });

    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.running).toBe(false);
  });

  /**
   * There used to be a `reset()` here that this test called. Nothing in the
   * app ever did — the retry path is a second `generate`, which clears the
   * previous failure itself, and the hook unmounts with the dialog. Asserting
   * on the real retry keeps the guarantee and drops the dead API.
   */
  it("clears the previous failure when a retry starts, not only when it succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            // Never settles: the assertion is about the state a retry sets on
            // its way out, while it is still in flight.
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLocalTailorSidecar());
    await act(async () => {
      await result.current.generate({ jobId: "job-1", target: "resume" });
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.offline).toBe(true);

    act(() => {
      void result.current.generate({ jobId: "job-1", target: "resume" });
    });

    await waitFor(() => expect(result.current.running).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.offline).toBe(false);
  });
});
