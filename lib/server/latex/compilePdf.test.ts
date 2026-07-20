import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above ordinary declarations, so the stub error class has
// to be hoisted with it.
const { FakeSafeOutboundError } = vi.hoisted(() => ({
  FakeSafeOutboundError: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "SafeOutboundError";
    }
  },
}));

vi.mock("@/lib/server/net/safeFetch", () => ({
  SafeOutboundError: FakeSafeOutboundError,
  // Mirrors the real parser's contract: the https requirement is the check
  // that rejects a plain-http render URL, so the stub must enforce it too or
  // the test would pass against a parser that never rejects anything.
  parseSafeOutboundUrl: (url: string | URL) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new FakeSafeOutboundError("HTTPS_REQUIRED", "must use https");
    }
    return parsed;
  },
  safeOutboundFetch: (
    url: string | URL,
    init?: RequestInit,
  ) => fetch(url, { ...init, redirect: "manual" }),
}));

import { compileLatexToPdf, LatexRenderError } from "./compilePdf";

function mockRenderResponse(body: Buffer, init?: { ok?: boolean; status?: number }) {
  const arrayBuffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => arrayBuffer,
      json: async () => ({}),
      text: async () => "",
    })),
  );
}

describe("compileLatexToPdf integrity check", () => {
  const originalUrl = process.env.LATEX_RENDER_URL;
  const originalToken = process.env.LATEX_RENDER_TOKEN;

  beforeEach(() => {
    process.env.LATEX_RENDER_URL = "https://render.example";
    process.env.LATEX_RENDER_TOKEN = "render-token";
  });

  afterEach(() => {
    process.env.LATEX_RENDER_URL = originalUrl;
    process.env.LATEX_RENDER_TOKEN = originalToken;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-arms the breaker after a cooldown instead of latching open", async () => {
    // The breaker counts failures since the last success. When it opened it
    // kept that count, so after the cooldown a single failure pushed it back
    // over the threshold and re-opened it — one bad patch left renders failing
    // indefinitely even once the service recovered.
    vi.resetModules();
    vi.useFakeTimers();
    try {
      const { compileLatexToPdf: compile, LatexRenderError: RenderError } =
        await import("./compilePdf");

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status: 503,
          headers: { get: () => "text/plain" },
          arrayBuffer: async () => new ArrayBuffer(0),
          json: async () => ({}),
          text: async () => "down",
        })),
      );

      // Five infra failures trip it.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(compile("\\documentclass{article}")).rejects.toBeInstanceOf(
          RenderError,
        );
      }
      await expect(compile("\\documentclass{article}")).rejects.toThrow(
        /circuit open/i,
      );

      // Cooldown elapses, then one more failure. That single failure must not
      // be enough to re-open a freshly re-armed breaker.
      vi.advanceTimersByTime(31_000);
      await expect(compile("\\documentclass{article}")).rejects.toBeInstanceOf(
        RenderError,
      );
      await expect(
        compile("\\documentclass{article}"),
      ).rejects.not.toThrow(/circuit open/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names why a render URL was rejected without echoing the URL", async () => {
    // The catch collapsed every parse failure into "Render service URL is
    // invalid", so an operator saw a 503 with no way to tell an http:// URL
    // from a malformed one. The reason is surfaced; the URL is not, because
    // it can carry a token in its path.
    process.env.LATEX_RENDER_URL = "http://render.internal/compile";

    const err = await compileLatexToPdf("\documentclass{article}").catch(
      (caught: unknown) => caught,
    );

    expect(err).toBeInstanceOf(LatexRenderError);
    const rendered = err as LatexRenderError;
    expect(rendered.code).toBe("LATEX_RENDER_CONFIG_MISSING");
    expect(rendered.details).toEqual({ reason: "HTTPS_REQUIRED" });
    expect(JSON.stringify(rendered.details)).not.toContain("render.internal");
  });

  it("returns the buffer for a well-formed PDF payload", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4000, 0x20)]);
    mockRenderResponse(pdf);

    const out = await compileLatexToPdf("\\documentclass{article}\\begin{document}x\\end{document}");

    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(out.byteLength).toBe(pdf.byteLength);
  });

  it("rejects a 200 response whose body is not a PDF", async () => {
    mockRenderResponse(Buffer.from("<html>render error</html>".padEnd(4000, " ")));

    await expect(compileLatexToPdf("x")).rejects.toMatchObject({
      code: "LATEX_RENDER_FAILED",
    });
  });

  it("rejects a truncated PDF below the size floor", async () => {
    mockRenderResponse(Buffer.from("%PDF-1.7 tiny"));

    await expect(compileLatexToPdf("x")).rejects.toBeInstanceOf(LatexRenderError);
  });
});
