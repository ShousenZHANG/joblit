import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import {
  discardDraft,
  extractMessage,
  finalizeApplication,
  parseRetryAfterSeconds,
  renderPreview,
} from "./tailorActions";

const APPLICATION_ID = "app-1";

const publication: ApplicationPublication = {
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

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-20T00:00:00.000Z",
  promptMetaHash: "prompt",
  cv: {
    summary: { aiText: "Summary", originalText: "Base", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

function pdfResponse() {
  return new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

/** Typed so the assertions can read back the url and init. */
function stubFetch(respond: () => Response) {
  const mock = vi.fn(async (..._args: FetchArgs) => respond());
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubObjectUrl(value = "blob:preview") {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => value,
    revokeObjectURL: () => undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseRetryAfterSeconds", () => {
  it.each([
    ["30", 30],
    ["  12  ", 12],
  ])("reads %j as %d", (header, expected) => {
    expect(parseRetryAfterSeconds(header)).toBe(expected);
  });

  // 0 means "retry now", so there is no window worth showing.
  it.each([null, "", "soon", "-5", "0"])(
    "returns null for %j",
    (header) => {
      expect(parseRetryAfterSeconds(header)).toBeNull();
    },
  );
});

describe("extractMessage", () => {
  it("prefers a real error message", () => {
    expect(extractMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("falls back for a value that is not an Error", () => {
    expect(extractMessage("nope", "fallback")).toBe("fallback");
    expect(extractMessage(null, "fallback")).toBe("fallback");
    expect(extractMessage({ message: "not an Error" }, "fallback")).toBe(
      "fallback",
    );
  });
});

describe("renderPreview", () => {
  /**
   * The review dialog validated the response and the route page did not: its
   * copy accepted any 2xx body as a PDF, ignored Retry-After on a 429, and had
   * no abort. Both surfaces render the same document, so both get the checks.
   */
  it("returns an object url for a PDF response", async () => {
    stubFetch(pdfResponse);
    stubObjectUrl();

    await expect(
      renderPreview({
        applicationId: APPLICATION_ID,
        target: "resume",
        expectedHash: "hash",
      }),
    ).resolves.toBe("blob:preview");
  });

  it("rejects a 2xx response that is not a PDF", async () => {
    stubFetch(
      () =>
        new Response(new Blob(["<html>"], { type: "text/html" }), {
          status: 200,
        }),
    );

    await expect(
      renderPreview({
        applicationId: APPLICATION_ID,
        target: "resume",
        expectedHash: "hash",
      }),
    ).rejects.toThrow(/invalid document/i);
  });

  it("surfaces the retry window on a rate limit", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "Too many" } }), {
          status: 429,
          headers: { "Retry-After": "42" },
        }),
    );

    await expect(
      renderPreview({
        applicationId: APPLICATION_ID,
        target: "cover",
        expectedHash: "hash",
      }),
    ).rejects.toThrow(/Too many[\s\S]*42 seconds/);
  });

  it("does not invent a retry window for other failures", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "Renderer down" } }), {
          status: 503,
        }),
    );

    await expect(
      renderPreview({
        applicationId: APPLICATION_ID,
        target: "resume",
        expectedHash: "hash",
      }),
    ).rejects.toThrow(/^Renderer down$/);
  });

  it("passes the abort signal through", async () => {
    const controller = new AbortController();
    const fetchMock = stubFetch(pdfResponse);
    stubObjectUrl();

    await renderPreview({
      applicationId: APPLICATION_ID,
      target: "resume",
      expectedHash: "hash",
      signal: controller.signal,
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("targets the preview route, never finalize", async () => {
    // Refresh used to POST /finalize on the route page, which published the
    // draft. A preview must not commit.
    const fetchMock = stubFetch(pdfResponse);
    stubObjectUrl();

    await renderPreview({
      applicationId: APPLICATION_ID,
      target: "cover",
      expectedHash: "hash",
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(`/api/applications/${APPLICATION_ID}/preview?target=cover`);
    expect(url).not.toContain("finalize");
  });
});

describe("finalizeApplication and discardDraft", () => {
  it("sends the expected hash so a stale edit cannot commit", async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({
          status: "FINAL",
          publication,
          aiContentHash: "hash-1",
          resumePdfUrl: "https://example.test/resume.pdf",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await finalizeApplication({
      applicationId: APPLICATION_ID,
      target: "resume",
      expectedHash: "hash-1",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `/api/applications/${APPLICATION_ID}/finalize?target=resume`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedHash: "hash-1",
    });
  });

  it("discards against the expected hash", async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({
          aiContent,
          aiContentHash: "h2",
          publication,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await discardDraft({ applicationId: APPLICATION_ID, expectedHash: "hash-1" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`/api/applications/${APPLICATION_ID}/discard`);
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedHash: "hash-1",
    });
  });

  it("rejects a finalize response with invalid publication metadata", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({
          status: "FINAL",
          aiContentHash: "hash-1",
          publication: { status: "FINAL" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      finalizeApplication({
        applicationId: APPLICATION_ID,
        target: "resume",
        expectedHash: "hash-1",
      }),
    ).rejects.toThrow("Response shape invalid");
  });

  it("rejects a discard response with invalid publication metadata", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({
          aiContent,
          aiContentHash: "hash-2",
          publication: { status: "DRAFT" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      discardDraft({
        applicationId: APPLICATION_ID,
        expectedHash: "hash-1",
      }),
    ).rejects.toThrow("Response shape invalid");
  });

  it("rejects a successful discard response without a CAS hash", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({
          aiContent,
          aiContentHash: null,
          publication,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      discardDraft({
        applicationId: APPLICATION_ID,
        expectedHash: "hash-1",
      }),
    ).rejects.toThrow("Response shape invalid");
  });
});
