import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  markTaskComplete: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  setQueryData: vi.fn(),
  findAll: vi.fn(() => [{ queryKey: ["jobs", "status=NEW"] }]),
}));

vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({ markTaskComplete: dependencies.markTaskComplete }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: dependencies.invalidateQueries,
      setQueryData: dependencies.setQueryData,
      getQueryCache: () => ({ findAll: dependencies.findAll }),
    }),
  };
});

import { useTailorReviewController } from "./useTailorReviewController";

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_JOB_ID = "44444444-4444-4444-8444-444444444444";

const snapshot = {
  applicationId: APPLICATION_ID,
  publication: {
    status: "FINAL",
    resume: {
      status: "FINAL",
      contentHash: "resume-content",
      publishedHash: "resume-content",
    },
    cover: {
      status: "FINAL",
      contentHash: "cover-content",
      publishedHash: "cover-content",
    },
  },
  aiContentHash: "content-hash",
  aiContent: {
    schemaVersion: 1,
    generatedAt: "2026-08-10T00:00:00.000Z",
    promptMetaHash: "prompt-hash",
    provenance: {
      resume: {
        generatedAt: "2026-08-10T00:00:00.000Z",
        promptMetaHash: "resume-prompt",
        source: "codex_batch",
      },
      cover: {
        generatedAt: "2026-08-10T00:01:00.000Z",
        promptMetaHash: "cover-prompt",
        source: "codex_batch",
      },
    },
    cv: {
      summary: {
        aiText: "Platform engineer.",
        originalText: "Engineer.",
        accepted: true,
      },
      latestExperience: { experienceIndex: 0, addedBullets: [] },
    },
    cover: {
      paragraphOne: { aiText: "One", accepted: true },
      paragraphTwo: { aiText: "Two", accepted: true },
      paragraphThree: { aiText: "Three", accepted: true },
    },
  },
  documents: {
    resume: { pdfUrl: "https://example.com/cv.pdf", pdfName: "Stored CV.pdf" },
    cover: { pdfUrl: "https://example.com/cl.pdf", pdfName: "Stored CL.pdf" },
  },
  job: {
    id: JOB_ID,
    title: "Platform Engineer",
    company: "Lumi",
    location: "Sydney",
    market: "AU",
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useTailorReviewController", () => {
  beforeEach(() => {
    dependencies.markTaskComplete.mockReset();
    dependencies.invalidateQueries.mockClear();
    dependencies.setQueryData.mockClear();
    dependencies.findAll.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads one owned snapshot on demand and opens the existing edit session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(snapshot));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTailorReviewController());

    let opened = false;
    await act(async () => {
      opened = await result.current.openApplicationReview({
        applicationId: APPLICATION_ID,
        jobId: JOB_ID,
        target: "cover",
      });
    });

    expect(opened).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/applications/${APPLICATION_ID}/review-snapshot`,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.current.draft).toEqual(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        target: "cover",
        source: "ai",
        initialAiContentHash: "content-hash",
        pdfName: "Stored CL.pdf",
      }),
    );
    expect(result.current.loadError).toBeNull();
  });

  it("keeps the caller in Batch details when loading is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: "APPLICATION_REVIEW_SETTLING",
              message: "Generation is still settling.",
            },
          },
          409,
        ),
      ),
    );
    const { result } = renderHook(() => useTailorReviewController());

    let opened = true;
    await act(async () => {
      opened = await result.current.openApplicationReview({
        applicationId: APPLICATION_ID,
        jobId: JOB_ID,
        target: "resume",
      });
    });

    expect(opened).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.loadError).toBe("Generation is still settling.");
  });

  it("cancels and fences a stale response so it cannot open after close", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const { result } = renderHook(() => useTailorReviewController());

    let request!: Promise<boolean>;
    act(() => {
      request = result.current.openApplicationReview({
        applicationId: APPLICATION_ID,
        jobId: JOB_ID,
        target: "resume",
      });
    });
    await waitFor(() => expect(result.current.loading).not.toBeNull());
    act(() => result.current.cancelApplicationReviewLoad());
    resolveFetch(json(snapshot));
    await act(async () => void (await request));

    expect(result.current.draft).toBeNull();
    expect(result.current.loading).toBeNull();
  });

  it("fails closed when the loaded Application belongs to a different job context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(snapshot)));
    const { result } = renderHook(() => useTailorReviewController());

    let opened = true;
    await act(async () => {
      opened = await result.current.openApplicationReview({
        applicationId: APPLICATION_ID,
        jobId: OTHER_JOB_ID,
        target: "resume",
      });
    });

    expect(opened).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.loadError).toBe(
      "This result no longer matches the selected job.",
    );
  });

  it("patches the Jobs cache after the shared editor finalizes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(snapshot)));
    const { result } = renderHook(() => useTailorReviewController());

    await act(async () => {
      await result.current.openApplicationReview({
        applicationId: APPLICATION_ID,
        jobId: JOB_ID,
        target: "resume",
      });
    });
    act(() => {
      result.current.handleFinalized({
        target: "resume",
        resumePdfUrl: "https://example.com/final-cv.pdf",
        resumePdfName: "Final CV.pdf",
      });
    });

    expect(dependencies.setQueryData).toHaveBeenCalledWith(
      ["jobs", "status=NEW"],
      expect.any(Function),
    );
    expect(dependencies.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["jobs"],
      refetchType: "active",
    });
  });
});
