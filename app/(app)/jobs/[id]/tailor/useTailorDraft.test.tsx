import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

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
    skillsAdditions: [],
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
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
    act(() => result.current.replaceFromServer(initialAiContent, "reset-hash"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(api.fetchJson).not.toHaveBeenCalled();
    expect(result.current.currentHash).toBe("reset-hash");
    expect(result.current.saveStatus.kind).toBe("saved");
  });
});
