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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLocalTailorSidecar", () => {
  it("returns the generated JSON and reports progress along the way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamOf([
          { phase: "prompt", chars: 20000, job: "AI Engineer" },
          { phase: "generate", attempt: 1, of: 3 },
          { phase: "done", ok: true, attempts: 1, aiContent: AI_CONTENT },
        ]),
      ),
    );

    const { result } = renderHook(() => useLocalTailorSidecar());
    let generated: string | null = null;
    await act(async () => {
      generated = await result.current.generate({ jobId: "job-1", target: "resume" });
    });

    expect(generated).toBe(JSON.stringify(AI_CONTENT, null, 2));
    expect(result.current.error).toBeNull();
    expect(result.current.running).toBe(false);
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

  it("clears state on reset so a retry does not show the old failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { result } = renderHook(() => useLocalTailorSidecar());
    await act(async () => {
      await result.current.generate({ jobId: "job-1", target: "resume" });
    });
    expect(result.current.error).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
    expect(result.current.offline).toBe(false);
  });
});
