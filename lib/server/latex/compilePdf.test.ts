import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
