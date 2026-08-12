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
const publication = {
  status: "DRAFT" as const,
  resume: {
    status: "DRAFT" as const,
    contentHash: "resume-v2",
    publishedHash: null,
  },
  cover: {
    status: "MISSING" as const,
    contentHash: null,
    publishedHash: null,
  },
};

describe("persistGeneratedDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts local output exactly once and trusts authoritative response job metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      applicationId: "app-1",
      status: "DRAFT",
      publication,
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
      source: "manual_import",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications/manual-generate?finalize=false",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      source: "manual_import",
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      target: "resume",
      modelOutput: "{\"canonicalOutput\":true}",
    });
    expect(draft.job).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Server Role",
      company: "Server Co",
      location: "Sydney",
    });
  });

  it.each([
    [
      "invalid AI Content",
      {
        applicationId: "app-1",
        status: "DRAFT",
        publication,
        aiContentHash: "content-hash",
        aiContent: { schemaVersion: 999 },
        job: {
          id: JOB_ID,
          title: "Server Role",
          company: "Server Co",
          location: "Sydney",
        },
      },
    ],
    [
      "a missing CAS hash",
      {
        applicationId: "app-1",
        status: "DRAFT",
        publication,
        aiContentHash: null,
        aiContent,
        job: {
          id: JOB_ID,
          title: "Server Role",
          company: "Server Co",
          location: "Sydney",
        },
      },
    ],
    [
      "a status that disagrees with publication",
      {
        applicationId: "app-1",
        status: "FINAL",
        publication,
        aiContentHash: "content-hash",
        aiContent,
        job: {
          id: JOB_ID,
          title: "Server Role",
          company: "Server Co",
          location: "Sydney",
        },
      },
    ],
  ])("rejects a 2xx response with %s", async (_label, responseBody) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      persistGeneratedDraft({
        jobId: JOB_ID,
        target: "resume",
        modelOutput: "{\"canonicalOutput\":true}",
        source: "manual_import",
      }),
    ).rejects.toThrow("Response shape invalid");
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

describe("useExternalGenerate prompt request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for a prompt with nothing but the job and the target", async () => {
    // The request used to carry source, delivery and a sessionStorage-backed
    // issue key, and the server minted a TailoringRun from them. That run
    // fenced an unattended worker's retries against each other; a person
    // pressing Copy has none, so the key and its rotate-on-conflict recovery
    // went with it.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          prompt: { systemPrompt: "sys", userPrompt: "usr", shortUserPrompt: "" },
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
            promptHash: "canonical-hash",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useExternalGenerate(() => {}));
    await act(async () => {
      await result.current.openExternalGenerateDialog(
        { id: JOB_ID, title: "Engineer" } as never,
        "resume",
      );
    });

    const promptCall = fetchMock.mock.calls.find(
      (call: unknown[]) => String(call[0]).includes("/api/applications/prompt"),
    );
    expect(promptCall).toBeDefined();
    expect(JSON.parse(String((promptCall as unknown[])[1] && (promptCall as [string, { body: string }])[1].body))).toEqual({
      jobId: JOB_ID,
      target: "resume",
    });
  });
});
