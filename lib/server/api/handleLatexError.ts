import { NextResponse } from "next/server";
import { LatexRenderError } from "@/lib/server/latex/compilePdf";
import { reportError } from "@/lib/server/observability/errorReporter";

export function handleLatexError(err: unknown, requestId: string): NextResponse | null {
  if (err instanceof LatexRenderError) {
    // The raw upstream render-service body (err.details) can contain internal
    // hostnames / stack traces. Keep it server-side via the observability seam
    // and return only a stable code + safe message to the browser.
    reportError(err, {
      scope: "latex.render",
      requestId,
      tags: { code: err.code, status: err.status },
      extra: { details: err.details },
    });
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
        },
        requestId,
      },
      { status: err.status },
    );
  }
  return null;
}
