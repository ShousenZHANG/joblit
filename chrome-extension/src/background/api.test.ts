import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@ext/shared/constants";
import { fetchAiPromptEnvelope } from "./api";

describe("fetchAiPromptEnvelope", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: "jfext_test" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the fixed extension-authenticated prompt route", async () => {
    const payload = { prompt: { input: "input", instructions: "rules", sessionId: "session" }, promptMeta: {}, promptVersion: "v4-application-proposal" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAiPromptEnvelope({
      jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      target: "resume",
      issueKey: "550e8400-e29b-41d4-a716-446655440000",
    })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.joblit.tech/api/ext/applications/prompt",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
          target: "resume",
          issueKey: "550e8400-e29b-41d4-a716-446655440000",
        }),
      }),
    );
    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty("runId");
    expect(requestBody).not.toHaveProperty("run_id");
    expect(requestBody).not.toHaveProperty("sessionId");
    expect(requestBody).not.toHaveProperty("session_id");
  });

  it("falls back once to the legacy strict body during a rolling deploy", async () => {
    const payload = {
      prompt: {
        input: "input",
        instructions: "rules",
        sessionId: "session",
      },
      promptMeta: {},
      promptVersion: "v4-application-proposal",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "INVALID_BODY", message: "Invalid request body" },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAiPromptEnvelope({
        jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
        target: "cover",
        issueKey: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).resolves.toEqual({
      ...payload,
      legacyTailoringRunProtocol: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
      ),
    ).toEqual({
      jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      target: "cover",
    });
  });
});
