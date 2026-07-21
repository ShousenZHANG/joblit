import { afterEach, describe, expect, it, vi } from "vitest";

import { persistGeneratedDraft } from "./useExternalGenerate";

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
    });
    expect(draft.job).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Server Role",
      company: "Server Co",
      location: "Sydney",
    });
  });
});
