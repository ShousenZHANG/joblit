import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";

const api = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock("@/lib/api/fetchJson", () => ({
  fetchJson: api.fetchJson,
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

import { useTailorDraft } from "./useTailorDraft";

const initialAiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-20T00:00:00.000Z",
  promptMetaHash: "prompt",
  cv: {
    summary: { aiText: "Initial", originalText: "Base", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

const initialPublication: ApplicationPublication = {
  status: "FINAL",
  resume: {
    status: "FINAL",
    contentHash: "resume-v1",
    publishedHash: "resume-v1",
  },
  cover: {
    status: "FINAL",
    contentHash: "cover-v1",
    publishedHash: "cover-v1",
  },
};

describe("useTailorDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.fetchJson.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("rejects flushNow when the pending draft was not saved", async () => {
    api.fetchJson.mockRejectedValueOnce(new Error("network offline"));
    const { result } = renderHook(() =>
      useTailorDraft({
        applicationId: "application-1",
        initialAiContent,
        initialAiContentHash: "initial-hash",
        initialPublication,
        debounceMs: 2_000,
      }),
    );
    const edited = {
      ...initialAiContent,
      cv: {
        ...initialAiContent.cv,
        summary: { ...initialAiContent.cv.summary, userEdit: "Unsaved edit" },
      },
    };

    act(() => result.current.setAiContent(edited));
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.flushNow();
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("network offline");
    expect(api.fetchJson).toHaveBeenCalledOnce();
    expect(result.current.saveStatus.kind).toBe("error");
  });

  it("cancels a pending debounce when server content replaces the draft", async () => {
    const { result } = renderHook(() =>
      useTailorDraft({
        applicationId: "application-1",
        initialAiContent,
        initialAiContentHash: "initial-hash",
        initialPublication,
        debounceMs: 2_000,
      }),
    );
    const edited = {
      ...initialAiContent,
      cv: {
        ...initialAiContent.cv,
        summary: { ...initialAiContent.cv.summary, userEdit: "Discard me" },
      },
    };

    act(() => result.current.setAiContent(edited));
    act(() =>
      result.current.replaceFromServer(initialAiContent, {
        aiContentHash: "reset-hash",
        publication: initialPublication,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(api.fetchJson).not.toHaveBeenCalled();
    expect(result.current.currentHash).toBe("reset-hash");
    expect(result.current.saveStatus.kind).toBe("saved");
  });

  it("returns the aggregate CAS hash and target publication truth from a save", async () => {
    const savedPublication: ApplicationPublication = {
      status: "DRAFT",
      resume: {
        status: "DRAFT",
        contentHash: "resume-v2",
        publishedHash: "resume-v1",
      },
      cover: initialPublication.cover,
    };
    api.fetchJson.mockResolvedValueOnce({
      aiContentHash: "aggregate-v2",
      publication: savedPublication,
    });
    const onCommitted = vi.fn();
    const { result } = renderHook(() =>
      useTailorDraft({
        applicationId: "application-1",
        initialAiContent,
        initialAiContentHash: "aggregate-v1",
        initialPublication,
        onCommitted,
        debounceMs: 2_000,
      }),
    );

    act(() =>
      result.current.setAiContent({
        ...initialAiContent,
        cv: {
          ...initialAiContent.cv,
          summary: {
            ...initialAiContent.cv.summary,
            userEdit: "Target-scoped edit",
          },
        },
      }),
    );

    let commit: Awaited<ReturnType<typeof result.current.flushNow>> | undefined;
    await act(async () => {
      commit = await result.current.flushNow();
    });

    expect(commit).toEqual({
      aiContentHash: "aggregate-v2",
      publication: savedPublication,
    });
    expect(result.current.currentHash).toBe("aggregate-v2");
    expect(result.current.publication).toEqual(savedPublication);
    expect(onCommitted).toHaveBeenCalledWith(commit);
  });

  it("uses the server hash from Finalize as the next whole-row CAS token", async () => {
    const finalizedPublication: ApplicationPublication = {
      ...initialPublication,
      status: "DRAFT",
      cover: {
        status: "DRAFT",
        contentHash: "cover-v2",
        publishedHash: "cover-v1",
      },
    };
    api.fetchJson.mockResolvedValueOnce({
      aiContentHash: "aggregate-after-cover-edit",
      publication: finalizedPublication,
    });
    const { result } = renderHook(() =>
      useTailorDraft({
        applicationId: "application-1",
        initialAiContent,
        initialAiContentHash: "aggregate-before-finalize",
        initialPublication,
        debounceMs: 2_000,
      }),
    );

    act(() =>
      result.current.acceptServerCommit({
        aiContentHash: "aggregate-from-finalize",
        publication: initialPublication,
      }),
    );
    act(() =>
      result.current.setAiContent({
        ...initialAiContent,
        cover: {
          ...initialAiContent.cover,
          paragraphOne: {
            ...initialAiContent.cover.paragraphOne,
            userEdit: "Edit the other document after Finalize",
          },
        },
      }),
    );
    await act(async () => {
      await result.current.flushNow();
    });

    expect(result.current.currentHash).toBe("aggregate-after-cover-edit");
    expect(api.fetchJson.mock.calls[0]?.[0]).toBe(
      "/api/applications/application-1/draft",
    );
    expect(
      JSON.parse(String(api.fetchJson.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      expectedHash: "aggregate-from-finalize",
    });
  });

  it("rejects a successful draft response without a CAS hash", async () => {
    api.fetchJson.mockImplementationOnce(
      async (
        _url: string,
        options: {
          schema?: {
            safeParse: (value: unknown) =>
              | { success: true; data: unknown }
              | { success: false };
          };
        },
      ) => {
        const parsed = options.schema?.safeParse({
          aiContentHash: null,
          publication: initialPublication,
        });
        if (!parsed?.success) throw new Error("Response shape invalid");
        return parsed.data;
      },
    );
    const { result } = renderHook(() =>
      useTailorDraft({
        applicationId: "application-1",
        initialAiContent,
        initialAiContentHash: "aggregate-v1",
        initialPublication,
        debounceMs: 2_000,
      }),
    );

    act(() =>
      result.current.setAiContent({
        ...initialAiContent,
        cv: {
          ...initialAiContent.cv,
          summary: {
            ...initialAiContent.cv.summary,
            userEdit: "Target-scoped edit",
          },
        },
      }),
    );

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.flushNow();
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Response shape invalid");
    expect(result.current.saveStatus.kind).toBe("error");
  });
});
