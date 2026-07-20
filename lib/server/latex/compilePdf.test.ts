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
  parseSafeOutboundUrl: (
    url: string | URL,
    policy?: { allowInsecureHttp?: boolean },
  ) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !policy?.allowInsecureHttp) {
      throw new FakeSafeOutboundError("HTTPS_REQUIRED", "must use https");
    }
    return parsed;
  },
  safeOutboundFetch: (
    url: string | URL,
    init?: RequestInit,
    policy?: { allowInsecureHttp?: boolean },
  ) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !policy?.allowInsecureHttp) {
      throw new FakeSafeOutboundError("HTTPS_REQUIRED", "must use https");
    }
    return fetch(url, { ...init, redirect: "manual" });
  },
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
  const originalInsecure = process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP;

  beforeEach(() => {
    process.env.LATEX_RENDER_URL = "https://render.example";
    process.env.LATEX_RENDER_TOKEN = "render-token";
    delete process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP;
  });

  afterEach(() => {
    process.env.LATEX_RENDER_URL = originalUrl;
    process.env.LATEX_RENDER_TOKEN = originalToken;
    if (originalInsecure === undefined) {
      delete process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP;
    } else {
      process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP = originalInsecure;
    }
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

  it("rejects an http renderer unless the deployment opts in", async () => {
    // The opt-in puts a credential on the wire in cleartext, so it cannot be
    // the default: a URL mistyped as http must fail loudly rather than
    // silently downgrade a deployment that has TLS.
    process.env.LATEX_RENDER_URL = "http://render.example/compile";
    delete process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP;

    const err = await compileLatexToPdf("\\documentclass{article}").catch(
      (caught: unknown) => caught,
    );

    expect(err).toBeInstanceOf(LatexRenderError);
    expect((err as LatexRenderError).details).toEqual({
      reason: "HTTPS_REQUIRED",
    });
  });

  it("reaches an http renderer once the deployment opts in", async () => {
    process.env.LATEX_RENDER_URL = "http://render.example/compile";
    process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP = "true";
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(4000, 0x20),
    ]);
    mockRenderResponse(pdf);

    const out = await compileLatexToPdf(
      "\\documentclass{article}\\begin{document}x\\end{document}",
    );

    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("treats any value other than \"true\" as opted out", async () => {
    process.env.LATEX_RENDER_URL = "http://render.example/compile";
    process.env.LATEX_RENDER_ALLOW_INSECURE_HTTP = "1";

    const err = await compileLatexToPdf("\\documentclass{article}").catch(
      (caught: unknown) => caught,
    );

    expect((err as LatexRenderError).details).toEqual({
      reason: "HTTPS_REQUIRED",
    });
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
