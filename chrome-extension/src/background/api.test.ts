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
    })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.joblit.tech/api/ext/applications/prompt",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538", target: "resume" }),
      }),
    );
  });
});
