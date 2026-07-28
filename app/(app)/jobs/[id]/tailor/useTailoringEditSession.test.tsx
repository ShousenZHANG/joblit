import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { useTailoringEditSession } from "./useTailoringEditSession";

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-11T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: { aiText: "Summary", originalText: "Original", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

const draft = vi.hoisted(() => ({
  aiContent: null as AiContent | null,
  setAiContent: vi.fn(),
  saveStatus: { kind: "saved" as const, at: 1 },
  flushNow: vi.fn(),
  replaceFromServer: vi.fn(),
  currentHash: "hash-1" as string | null,
}));

const actions = vi.hoisted(() => ({
  renderPreview: vi.fn(),
  finalizeApplication: vi.fn(),
  discardDraft: vi.fn(),
}));

vi.mock("./useTailorDraft", () => ({
  useTailorDraft: () => ({
    ...draft,
    aiContent: draft.aiContent,
  }),
}));

vi.mock("./tailorActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tailorActions")>()),
  renderPreview: actions.renderPreview,
  finalizeApplication: actions.finalizeApplication,
  discardDraft: actions.discardDraft,
}));

const options = {
  applicationId: "application-1",
  initialStatus: "FINAL" as const,
  initialAiContent: aiContent,
  initialAiContentHash: "hash-1",
  initialResumePdfUrl: "/resume.pdf",
  initialCoverPdfUrl: "/cover.pdf",
  initialTarget: "resume" as const,
  messages: {
    conflict: "Draft changed elsewhere",
    saveFailed: "Save failed",
    previewFailed: "Preview failed",
    finalizeFailed: "Finalize failed",
    discardFailed: "Discard failed",
    exitFailed: "Save failed. Review is still open.",
  },
};

describe("useTailoringEditSession", () => {
  beforeEach(() => {
    draft.aiContent = aiContent;
    draft.setAiContent.mockReset();
    draft.saveStatus = { kind: "saved", at: 1 };
    draft.flushNow.mockReset().mockResolvedValue("hash-1");
    draft.replaceFromServer.mockReset();
    draft.currentHash = "hash-1";
    actions.renderPreview.mockReset().mockResolvedValue("blob:preview");
    actions.finalizeApplication.mockReset().mockResolvedValue({
      status: "FINAL",
      resumePdfUrl: "/final-resume.pdf",
      resumePdfName: "Engineer_CV.pdf",
    });
    actions.discardDraft.mockReset().mockResolvedValue({
      aiContent,
      aiContentHash: "hash-reset",
    });
    vi.stubGlobal("URL", {
      ...URL,
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves a finalized document back to draft when content changes", () => {
    const { result } = renderHook(() => useTailoringEditSession(options));
    const nextContent = {
      ...aiContent,
      cv: {
        ...aiContent.cv,
        summary: { ...aiContent.cv.summary, aiText: "Updated summary" },
      },
    };

    act(() => {
      result.current.content.update(() => nextContent);
    });

    expect(draft.setAiContent).toHaveBeenCalledWith(nextContent);
    expect(result.current.document.status).toBe("DRAFT");
    expect(result.current.preview.syncStatus).toBe("pending");
  });

  it("applies sequential functional edits to the latest in-session content", () => {
    const { result } = renderHook(() => useTailoringEditSession(options));

    act(() => {
      result.current.content.update((current) => ({
        ...current,
        cv: {
          ...current.cv,
          summary: { ...current.cv.summary, aiText: "First edit" },
        },
      }));
      result.current.content.update((current) => ({
        ...current,
        cv: {
          ...current.cv,
          summary: {
            ...current.cv.summary,
            originalText: current.cv.summary.aiText,
          },
        },
      }));
    });

    expect(draft.setAiContent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cv: expect.objectContaining({
          summary: expect.objectContaining({
            aiText: "First edit",
            originalText: "First edit",
          }),
        }),
      }),
    );
  });

  it("remains mounted across the StrictMode effect replay", async () => {
    const { result } = renderHook(() => useTailoringEditSession(options), {
      reactStrictMode: true,
    });

    await act(async () => {
      await result.current.preview.refresh();
    });

    expect(result.current.preview.url).toBe("blob:preview");
    expect(result.current.busy.refreshing).toBe(false);
  });

  it("treats a PDF retained by a draft as stale and renders it automatically", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useTailoringEditSession({
        ...options,
        initialStatus: "DRAFT",
        autoPreview: true,
      }),
    );

    expect(result.current.preview.url).toBe("/resume.pdf");
    expect(result.current.preview.syncStatus).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });

    expect(actions.renderPreview).toHaveBeenCalledOnce();
    expect(result.current.preview.url).toBe("blob:preview");
    expect(result.current.preview.syncStatus).toBe("synced");
  });

  it("flushes before rendering and replaces only the active preview", async () => {
    const { result } = renderHook(() => useTailoringEditSession(options));

    await act(async () => {
      await result.current.preview.refresh();
    });

    expect(draft.flushNow).toHaveBeenCalledOnce();
    expect(actions.renderPreview).toHaveBeenCalledWith({
      applicationId: "application-1",
      target: "resume",
      expectedHash: "hash-1",
      signal: expect.any(AbortSignal),
      fallbackMessage: "Preview failed",
    });
    expect(draft.flushNow.mock.invocationCallOrder[0]).toBeLessThan(
      actions.renderPreview.mock.invocationCallOrder[0],
    );
    expect(result.current.preview.url).toBe("blob:preview");
    expect(result.current.preview.syncStatus).toBe("synced");
    expect(result.current.document.status).toBe("FINAL");
  });

  it("settles a rendered document before starting a queued cross-target preview", async () => {
    vi.useFakeTimers();
    let resolveResumePreview: ((url: string) => void) | undefined;
    actions.renderPreview.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveResumePreview = resolve;
        }),
    );
    const { result } = renderHook(() => useTailoringEditSession(options));

    let resumePreviewPromise: Promise<boolean> | undefined;
    act(() => {
      resumePreviewPromise = result.current.preview.refresh();
    });
    await vi.waitFor(() => {
      expect(actions.renderPreview).toHaveBeenCalledOnce();
    });

    act(() => {
      result.current.document.select("cover");
    });
    await act(async () => {
      await result.current.preview.refresh();
    });

    await act(async () => {
      resolveResumePreview?.("blob:resume-preview");
      await resumePreviewPromise;
    });
    act(() => {
      result.current.document.select("resume");
    });

    expect(result.current.preview.url).toBe("blob:resume-preview");
    expect(result.current.preview.syncStatus).toBe("synced");
    expect(actions.renderPreview).toHaveBeenCalledOnce();

    act(() => {
      result.current.document.select("cover");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(actions.renderPreview).toHaveBeenCalledTimes(2);
    expect(actions.renderPreview.mock.calls[1]?.[0]?.target).toBe("cover");
    expect(result.current.preview.url).toBe("blob:preview");
    expect(result.current.preview.syncStatus).toBe("synced");
  });

  it("publishes only after pending edits flush and returns the server result", async () => {
    const { result } = renderHook(() => useTailoringEditSession(options));
    let finalized:
      | Awaited<ReturnType<typeof result.current.finalize>>
      | undefined;

    await act(async () => {
      finalized = await result.current.finalize();
    });

    expect(actions.finalizeApplication).toHaveBeenCalledWith({
      applicationId: "application-1",
      target: "resume",
      expectedHash: "hash-1",
    });
    expect(draft.flushNow.mock.invocationCallOrder[0]).toBeLessThan(
      actions.finalizeApplication.mock.invocationCallOrder[0],
    );
    expect(finalized?.resumePdfName).toBe("Engineer_CV.pdf");
    expect(result.current.document.status).toBe("FINAL");
    expect(result.current.preview.url).toBe("/final-resume.pdf");
  });

  it("keeps the finalized document synced when an aborted preview settles late", async () => {
    let resolvePreview: ((url: string) => void) | undefined;
    actions.renderPreview.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const { result } = renderHook(() => useTailoringEditSession(options));

    let previewPromise: Promise<boolean> | undefined;
    act(() => {
      previewPromise = result.current.preview.refresh();
    });
    await vi.waitFor(() => {
      expect(actions.renderPreview).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await result.current.finalize();
    });
    expect(result.current.preview.url).toBe("/final-resume.pdf");
    expect(result.current.preview.syncStatus).toBe("synced");

    await act(async () => {
      resolvePreview?.("blob:late-preview");
      await previewPromise;
    });

    expect(result.current.preview.url).toBe("/final-resume.pdf");
    expect(result.current.preview.syncStatus).toBe("synced");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late-preview");
    expect(result.current.busy.refreshing).toBe(false);
    expect(result.current.busy.finalizing).toBe(false);
  });

  it("does not mark a different document synced after finalization takes ownership", async () => {
    let resolvePreview: ((url: string) => void) | undefined;
    actions.renderPreview.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    actions.finalizeApplication.mockResolvedValueOnce({
      status: "FINAL",
      coverPdfUrl: "/final-cover.pdf",
      coverPdfName: "Engineer_CL.pdf",
    });
    const { result } = renderHook(() => useTailoringEditSession(options));

    let previewPromise: Promise<boolean> | undefined;
    act(() => {
      previewPromise = result.current.preview.refresh();
    });
    await vi.waitFor(() => {
      expect(actions.renderPreview).toHaveBeenCalledOnce();
    });
    act(() => {
      result.current.document.select("cover");
    });

    await act(async () => {
      await result.current.finalize();
      resolvePreview?.("blob:late-resume-preview");
      await previewPromise;
    });

    expect(result.current.preview.url).toBe("/final-cover.pdf");
    expect(result.current.preview.syncStatus).toBe("synced");

    act(() => {
      result.current.document.select("resume");
    });
    expect(result.current.preview.url).toBe("/resume.pdf");
    expect(result.current.preview.syncStatus).toBe("pending");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:late-resume-preview",
    );
  });

  it("invalidates retained previews after restoring the canonical draft", async () => {
    const { result } = renderHook(() => useTailoringEditSession(options));

    await act(async () => {
      await result.current.discard();
    });

    expect(draft.replaceFromServer).toHaveBeenCalledWith(
      aiContent,
      "hash-reset",
    );
    expect(result.current.document.status).toBe("DRAFT");
    expect(result.current.preview.syncStatus).toBe("pending");
  });

  it("keeps both documents pending when a discarded preview settles late", async () => {
    let resolvePreview: ((url: string) => void) | undefined;
    actions.renderPreview.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useTailoringEditSession({ ...options, initialTarget: "cover" }),
    );

    let previewPromise: Promise<boolean> | undefined;
    act(() => {
      previewPromise = result.current.preview.refresh();
    });
    await vi.waitFor(() => {
      expect(actions.renderPreview).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await result.current.discard();
      resolvePreview?.("blob:discarded-preview");
      await previewPromise;
    });

    expect(result.current.preview.url).toBe("/cover.pdf");
    expect(result.current.preview.syncStatus).toBe("pending");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:discarded-preview",
    );

    act(() => {
      result.current.document.select("resume");
    });
    expect(result.current.preview.url).toBe("/resume.pdf");
    expect(result.current.preview.syncStatus).toBe("pending");
    expect(result.current.busy.refreshing).toBe(false);
    expect(result.current.busy.discarding).toBe(false);
  });

  it("serializes publication and rejects edits or destructive commands while it is pending", async () => {
    let resolveFinalize:
      | ((value: {
          status: "FINAL";
          resumePdfUrl: string;
        }) => void)
      | undefined;
    actions.finalizeApplication.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFinalize = resolve;
        }),
    );
    const { result } = renderHook(() => useTailoringEditSession(options));

    let finalizePromise: ReturnType<typeof result.current.finalize>;
    act(() => {
      finalizePromise = result.current.finalize();
    });

    act(() => {
      result.current.content.update((current) => current);
      result.current.document.select("cover");
    });
    let discarded = true;
    await act(async () => {
      discarded = await result.current.discard();
    });

    expect(draft.setAiContent).not.toHaveBeenCalled();
    expect(result.current.document.target).toBe("resume");
    expect(actions.discardDraft).not.toHaveBeenCalled();
    expect(discarded).toBe(false);

    await act(async () => {
      resolveFinalize?.({
        status: "FINAL",
        resumePdfUrl: "/serialized.pdf",
      });
      await finalizePromise!;
    });
  });

  it("exposes a working save retry through the shared session", async () => {
    draft.flushNow
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("hash-2");
    const { result } = renderHook(() => useTailoringEditSession(options));

    let firstAttempt = true;
    await act(async () => {
      firstAttempt = await result.current.content.retrySave();
    });
    expect(firstAttempt).toBe(false);
    expect(result.current.issue.message).toBe("offline");

    let retried = false;
    await act(async () => {
      retried = await result.current.content.retrySave();
    });
    expect(retried).toBe(true);
    expect(result.current.issue.message).toBeNull();
  });

  it("owns the save-before-exit failure state and does not run the adapter", async () => {
    draft.flushNow.mockRejectedValueOnce(new Error("network offline"));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useTailoringEditSession(options));

    await act(async () => {
      await result.current.saveAndExit(onSaved);
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.issue.message).toBe("network offline");
    expect(result.current.busy.exiting).toBe(false);
  });

  it("keeps save-and-exit ownership when an aborted preview settles late", async () => {
    let resolvePreview: ((url: string) => void) | undefined;
    actions.renderPreview.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const onSaved = vi.fn();
    const { result } = renderHook(() => useTailoringEditSession(options));

    let previewPromise: Promise<boolean> | undefined;
    act(() => {
      previewPromise = result.current.preview.refresh();
    });
    await vi.waitFor(() => {
      expect(actions.renderPreview).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await result.current.saveAndExit(onSaved);
    });
    const previewSignal = actions.renderPreview.mock.calls[0]?.[0]?.signal;
    expect(previewSignal?.aborted).toBe(true);

    await act(async () => {
      resolvePreview?.("blob:late-preview");
      await previewPromise;
    });

    expect(onSaved).toHaveBeenCalledOnce();
    expect(result.current.preview.url).toBe("/resume.pdf");
    expect(result.current.preview.syncStatus).toBe("pending");
    expect(result.current.busy.refreshing).toBe(false);
    expect(result.current.busy.exiting).toBe(false);
  });

  it("debounces automatic preview and aborts the request on unmount", async () => {
    vi.useFakeTimers();
    draft.currentHash = "hash-2";
    actions.renderPreview.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const { result, unmount } = renderHook(() =>
      useTailoringEditSession({
        ...options,
        initialResumePdfUrl: null,
        autoPreview: true,
      }),
    );

    expect(result.current.preview.syncStatus).toBe("pending");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });
    expect(actions.renderPreview).toHaveBeenCalledOnce();
    const signal = actions.renderPreview.mock.calls[0]?.[0]?.signal;

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
