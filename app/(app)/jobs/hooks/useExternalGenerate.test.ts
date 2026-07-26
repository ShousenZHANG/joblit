import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookDependencies = vi.hoisted(() => ({
  toast: vi.fn(),
  markTaskComplete: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: hookDependencies.toast }),
}));

vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({ markTaskComplete: hookDependencies.markTaskComplete }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => hookDependencies.queryClient,
  };
});

import {
  persistGeneratedDraft,
  useExternalGenerate,
} from "./useExternalGenerate";
import type { JobItem } from "../types";

const tailoringRun = {
  id: "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f",
  attemptId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
};

const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const OLD_ISSUE_KEY = "11111111-1111-4111-8111-111111111111";
const NEW_ISSUE_KEY = "22222222-2222-4222-8222-222222222222";
const ISSUE_STORAGE_KEY = `joblit.tailoring.manual.v1:${JOB_ID}:resume`;

const job: JobItem = {
  id: JOB_ID,
  jobUrl: "https://example.test/jobs/server-role",
  title: "Server Role",
  company: "Server Co",
  location: "Sydney",
  jobType: "Full-time",
  jobLevel: "Senior",
  status: "NEW",
  market: "AU",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

const aiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-15T00:00:00.000Z",
  promptMetaHash: "canonical-hash",
  source: "local_ai",
  cv: {
    summary: { aiText: "Summary", originalText: "Original", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "", accepted: false },
    paragraphTwo: { aiText: "", accepted: false },
    paragraphThree: { aiText: "", accepted: false },
  },
};

describe("persistGeneratedDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts local output exactly once and trusts authoritative response job metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      applicationId: "app-1",
      status: "DRAFT",
      aiContentHash: "content-hash",
      aiContent,
      job: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "Server Role",
        company: "Server Co",
        location: "Sydney",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const draft = await persistGeneratedDraft({
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      target: "resume",
      modelOutput: "{\"canonicalOutput\":true}",
      promptMeta: {
        ruleSetId: "rules-1",
        resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
        promptHash: "canonical-hash",
      },
      tailoringRun,
      source: "local_ai",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications/manual-generate?finalize=false",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      source: "local_ai",
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      target: "resume",
      modelOutput: "{\"canonicalOutput\":true}",
      tailoringRun,
    });
    expect(draft.job).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Server Role",
      company: "Server Co",
      location: "Sydney",
    });
  });
});

function promptResponse() {
  return new Response(
    JSON.stringify({
      prompt: {
        systemPrompt: "System instructions",
        userPrompt: "User instructions",
        shortUserPrompt: "Short instructions",
      },
      promptMeta: {
        ruleSetId: "rules-1",
        resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
        promptHash: "canonical-hash",
      },
      tailoringRun,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function apiErrorResponse(code: string, status = 409) {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: `Prompt failed with ${code}`,
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function readRequestBody(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("useExternalGenerate stable issue recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    hookDependencies.toast.mockReset();
    hookDependencies.markTaskComplete.mockReset();
    hookDependencies.queryClient.invalidateQueries.mockReset();
    hookDependencies.queryClient.invalidateQueries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["ISSUE_KEY_CONFLICT", "RUN_ALREADY_TERMINAL"] as const)(
    "rotates a stale issue key and retries %s exactly once",
    async (code) => {
      sessionStorage.setItem(ISSUE_STORAGE_KEY, OLD_ISSUE_KEY);
      const randomUuid = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValue(
          NEW_ISSUE_KEY as `${string}-${string}-${string}-${string}-${string}`,
        );
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(apiErrorResponse(code))
        .mockResolvedValueOnce(promptResponse());
      vi.stubGlobal("fetch", fetchMock);
      const setError = vi.fn();
      const { result } = renderHook(() => useExternalGenerate(setError));

      await act(async () => {
        await result.current.openExternalGenerateDialog(job, "resume");
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(readRequestBody(fetchMock, 0)).toMatchObject({
        jobId: JOB_ID,
        target: "resume",
        issueKey: OLD_ISSUE_KEY,
      });
      expect(readRequestBody(fetchMock, 1)).toMatchObject({
        jobId: JOB_ID,
        target: "resume",
        issueKey: NEW_ISSUE_KEY,
      });
      expect(randomUuid).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(ISSUE_STORAGE_KEY)).toBe(NEW_ISSUE_KEY);
      expect(result.current.externalTailoringRun).toEqual(tailoringRun);
      expect(setError).not.toHaveBeenCalledWith(
        expect.stringContaining("Prompt failed"),
      );
    },
  );

  it("does not rotate or retry a transport failure", async () => {
    sessionStorage.setItem(ISSUE_STORAGE_KEY, OLD_ISSUE_KEY);
    const randomUuid = vi.spyOn(crypto, "randomUUID");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const setError = vi.fn();
    const { result } = renderHook(() => useExternalGenerate(setError));

    await act(async () => {
      await result.current.openExternalGenerateDialog(job, "resume");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readRequestBody(fetchMock, 0)).toMatchObject({
      issueKey: OLD_ISSUE_KEY,
    });
    expect(randomUuid).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ISSUE_STORAGE_KEY)).toBe(OLD_ISSUE_KEY);
    expect(setError).toHaveBeenCalledWith("Network unavailable");
  });

  it("does not rotate or retry a validation rejection", async () => {
    sessionStorage.setItem(ISSUE_STORAGE_KEY, OLD_ISSUE_KEY);
    const randomUuid = vi.spyOn(crypto, "randomUUID");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiErrorResponse("INVALID_REQUEST", 400));
    vi.stubGlobal("fetch", fetchMock);
    const setError = vi.fn();
    const { result } = renderHook(() => useExternalGenerate(setError));

    await act(async () => {
      await result.current.openExternalGenerateDialog(job, "resume");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readRequestBody(fetchMock, 0)).toMatchObject({
      issueKey: OLD_ISSUE_KEY,
    });
    expect(randomUuid).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ISSUE_STORAGE_KEY)).toBe(OLD_ISSUE_KEY);
    expect(setError).toHaveBeenCalledWith(
      "Prompt failed with INVALID_REQUEST",
    );
  });

  it("clears the stable issue key after the generated draft is accepted", async () => {
    sessionStorage.setItem(ISSUE_STORAGE_KEY, OLD_ISSUE_KEY);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input) === "/api/applications/prompt") {
          return promptResponse();
        }
        if (
          String(input) ===
          "/api/applications/manual-generate?finalize=false"
        ) {
          return new Response(
            JSON.stringify({
              applicationId: "app-1",
              status: "DRAFT",
              aiContentHash: "content-hash",
              aiContent,
              pdfName: "Candidate Server Role_CV.pdf",
              job: {
                id: JOB_ID,
                title: job.title,
                company: job.company,
                location: job.location,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${String(input)}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useExternalGenerate(vi.fn()));

    await act(async () => {
      await result.current.openExternalGenerateDialog(job, "resume");
    });
    await waitFor(() =>
      expect(result.current.externalTailoringRun).toEqual(tailoringRun),
    );
    expect(sessionStorage.getItem(ISSUE_STORAGE_KEY)).toBe(OLD_ISSUE_KEY);

    await act(async () => {
      await result.current.generateFromImportedJson(
        job,
        "resume",
        "{\"canonicalOutput\":true}",
      );
    });

    expect(sessionStorage.getItem(ISSUE_STORAGE_KEY)).toBeNull();
    const importCall = fetchMock.mock.calls.find(
      ([input]) =>
        String(input) ===
        "/api/applications/manual-generate?finalize=false",
    );
    expect(
      JSON.parse(
        String((importCall?.[1] as RequestInit | undefined)?.body),
      ),
    ).toMatchObject({
      jobId: JOB_ID,
      target: "resume",
      tailoringRun,
    });
    expect(hookDependencies.markTaskComplete).toHaveBeenCalledWith(
      "generate_first_pdf",
    );
  });
});
