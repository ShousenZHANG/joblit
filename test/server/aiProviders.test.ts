import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/net/safeFetch", () => ({
  safeOutboundFetch: (
    url: string | URL,
    init?: RequestInit,
  ) => fetch(url, { ...init, redirect: "manual" }),
}));

import { callClaude, callGemini, callOpenAI } from "@/lib/server/ai/providers";

describe("ai providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls OpenAI endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const content = await callOpenAI({
      apiKey: "key",
      model: "gpt-4o-mini",
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(content).toContain("ok");
  });

  it("calls Gemini endpoint", async () => {
    const fetchMock = vi.fn(async (...args: unknown[]) => {
      void args;
      return {
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: "{\"ok\":true}" }] } },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const content = await callGemini({
      apiKey: "key",
      model: "gemini-2.5-flash-lite",
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("gemini-2.5-flash-lite");
    expect(content).toContain("ok");
  });

  it("calls Claude endpoint", async () => {
    const fetchMock = vi.fn(async (...args: unknown[]) => {
      void args;
      return {
        ok: true,
        json: async () => ({ content: [{ text: "{\"ok\":true}" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const content = await callClaude({
      apiKey: "key",
      model: "claude-3-5-sonnet",
      systemPrompt: "system",
      userPrompt: "user",
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(content).toContain("ok");
  });
});
