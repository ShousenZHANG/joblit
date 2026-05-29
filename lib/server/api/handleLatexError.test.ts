import { describe, it, expect } from "vitest";
import { handleLatexError } from "./handleLatexError";
import { LatexRenderError } from "@/lib/server/latex/compilePdf";

describe("handleLatexError", () => {
  it("returns NextResponse for LatexRenderError", async () => {
    const err = new LatexRenderError("LATEX_RENDER_FAILED", 502, "Render failed", {
      log: "some error log",
    });
    const res = handleLatexError(err, "req-123");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(502);
    const body = await res!.json();
    // Raw upstream details must NOT leak to the client — only code + message.
    expect(body).toEqual({
      error: {
        code: "LATEX_RENDER_FAILED",
        message: "Render failed",
      },
      requestId: "req-123",
    });
    expect(body.error.details).toBeUndefined();
  });

  it("returns null for non-LatexRenderError", () => {
    const res = handleLatexError(new Error("generic"), "req-456");
    expect(res).toBeNull();
  });

  it("returns null for non-Error values", () => {
    expect(handleLatexError("string error", "req-789")).toBeNull();
    expect(handleLatexError(null, "req-789")).toBeNull();
    expect(handleLatexError(undefined, "req-789")).toBeNull();
  });
});
