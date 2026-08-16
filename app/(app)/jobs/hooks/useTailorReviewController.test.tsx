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
import type { JobItem } from "../types";

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_JOB_ID = "44444444-4444-4444-8444-444444444444";

function job(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: JOB_ID,
    title: "Platform Engineer",
    company: "Lumi",
    location: "Sydney",
    jobUrl: "https://example.com/job",
    status: "NEW",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    applicationId: APPLICATION_ID,
    ...overrides,
  } as JobItem;
}

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
    schemaVersion: 2,
    generatedAt: "2026-08-10T00:00:00.000Z",
    promptMetaHash: "prompt-hash",
    cv: {
      summary: {
        aiText: "Platform engineer.",
        originalText: "Engineer.",
        accepted: true,
      },
      skillsSelection: { aiSelection: [{ group: 0, items: [0] }] },
    },
    cover: {
      paragraphOne: { aiText: "One", accepted: true },
      paragraphTwo: { aiText: "Two", accepted: true },
      paragraphThree: { aiText: "Three", accepted: true },
    },
  },
  masterSkills: [{ category: "Languages", items: ["TypeScript"] }],
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

  it("opens the dialog immediately and loads the owned snapshot behind it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(snapshot));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTailorReviewController());

    act(() => result.current.openTailorDialog(job(), "cover"));

    expect(result.current.session).toEqual({
      job: expect.objectContaining({ id: JOB_ID }),
      target: "cover",
    });
    await waitFor(() => expect(result.current.draft).not.toBeNull());
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
        source: "ai",
        initialAiContentHash: "content-hash",
        masterSkills: [{ category: "Languages", items: ["TypeScript"] }],
      }),
    );
    expect(result.current.draftError).toBeNull();
  });

  it("starts at the prompt step when the job has no Application yet", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTailorReviewController());

    act(() =>
      result.current.openTailorDialog(job({ applicationId: null }), "resume"),
    );

    expect(result.current.session).not.toBeNull();
    expect(result.current.draft).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and reports why a snapshot could not be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: "APPLICATION_REVIEW_UNAVAILABLE",
              message: "This generated document cannot be edited safely.",
            },
          },
          409,
        ),
      ),
    );
    const { result } = renderHook(() => useTailorReviewController());

    act(() => result.current.openTailorDialog(job(), "resume"));
    await waitFor(() => expect(result.current.draftError).not.toBeNull());

    expect(result.current.session).not.toBeNull();
    expect(result.current.draft).toBeNull();
    expect(result.current.draftError).toBe(
      "This generated document cannot be edited safely.",
    );
  });

  it("fences a stale response so it cannot land after the dialog closed", async () => {
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

    act(() => result.current.openTailorDialog(job(), "resume"));
    await waitFor(() => expect(result.current.draftLoading).toBe(true));
    act(() => result.current.cancelTailorDialog());
    await act(async () => {
      resolveFetch(json(snapshot));
    });

    expect(result.current.session).toBeNull();
    expect(result.current.draft).toBeNull();
    expect(result.current.draftLoading).toBe(false);
  });

  it("fails closed when the loaded Application belongs to a different job", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(snapshot)));
    const { result } = renderHook(() => useTailorReviewController());

    act(() =>
      result.current.openTailorDialog(job({ id: OTHER_JOB_ID }), "resume"),
    );
    await waitFor(() => expect(result.current.draftError).not.toBeNull());

    expect(result.current.draft).toBeNull();
    expect(result.current.draftError).toBe(
      "This result no longer matches the selected job.",
    );
  });

  it("re-reads the snapshot after an import so the skill bank is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(snapshot));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTailorReviewController());

    act(() =>
      result.current.openTailorDialog(job({ applicationId: null }), "resume"),
    );
    let loaded = false;
    await act(async () => {
      loaded = await result.current.handleImported({
        applicationId: APPLICATION_ID,
        jobId: JOB_ID,
        target: "resume",
      });
    });

    expect(loaded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.draft?.source).toBe("manual_import");
    expect(result.current.tailorSourceByJob[JOB_ID]).toEqual({
      cv: "manual_import",
    });
  });

  it("patches the Jobs cache after the editor publishes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(snapshot)));
    const { result } = renderHook(() => useTailorReviewController());

    act(() => result.current.openTailorDialog(job(), "resume"));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
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
