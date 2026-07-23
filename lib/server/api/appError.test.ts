import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const { AppError, toErrorResponse } = await import("@/lib/server/api/appError");

beforeEach(() => vi.clearAllMocks());

describe("toErrorResponse", () => {
  it("renders an AppError as the canonical envelope", async () => {
    const res = toErrorResponse(
      new AppError({ code: "NO_PROFILE", status: 404, publicMessage: "No profile" }),
      "req-1",
    );

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({
      error: { code: "NO_PROFILE", message: "No profile" },
      requestId: "req-1",
    });
  });

  it("returns publicDetails to the caller", async () => {
    const res = toErrorResponse(
      new AppError({
        code: "ATS_PDF_VALIDATION_FAILED",
        status: 422,
        publicMessage: "PDF failed validation",
        publicDetails: { errors: ["too few characters"] },
      }),
    );

    expect(await res?.json()).toEqual({
      error: {
        code: "ATS_PDF_VALIDATION_FAILED",
        message: "PDF failed validation",
        details: { errors: ["too few characters"] },
      },
    });
  });

  it("reports privateDetails and never returns them", async () => {
    const res = toErrorResponse(
      new AppError({
        code: "LATEX_RENDER_FAILED",
        status: 502,
        publicMessage: "Render failed",
        privateDetails: "at renderer.internal.example:9000 — stack trace",
      }),
      "req-2",
    );

    const body = JSON.stringify(await res?.json());
    expect(body).not.toContain("renderer.internal.example");
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: "app.error",
        requestId: "req-2",
        extra: { details: "at renderer.internal.example:9000 — stack trace" },
      }),
    );
  });

  it("recognises a pre-existing coded error and redacts its details", async () => {
    class LegacyError extends Error {
      code = "LATEX_RENDER_TIMEOUT";
      status = 504;
      details = "upstream said: host latex.internal timed out";
    }

    const res = toErrorResponse(new LegacyError("Render timed out"), "req-3");

    expect(res?.status).toBe(504);
    expect(await res?.json()).toEqual({
      error: { code: "LATEX_RENDER_TIMEOUT", message: "Render timed out" },
      requestId: "req-3",
    });
    expect(reportError).toHaveBeenCalled();
  });

  it("returns null for an unrecognised error so it bubbles to a 500", () => {
    expect(toErrorResponse(new Error("boom"))).toBeNull();
    expect(toErrorResponse("not even an error")).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not report an AppError that carries no private details", () => {
    toErrorResponse(new AppError({ code: "NOT_FOUND", status: 404, publicMessage: "Nope" }));
    expect(reportError).not.toHaveBeenCalled();
  });
});
