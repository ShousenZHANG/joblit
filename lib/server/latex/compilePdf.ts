import {
  SafeOutboundError,
  parseSafeOutboundUrl,
  safeOutboundFetch,
} from "@/lib/server/net/safeFetch";

type LatexRenderErrorCode =
  | "LATEX_RENDER_CONFIG_MISSING"
  | "LATEX_RENDER_UNREACHABLE"
  | "LATEX_RENDER_TIMEOUT"
  | "LATEX_RENDER_FAILED";

export class LatexRenderError extends Error {
  code: LatexRenderErrorCode;
  status: number;
  details?: unknown;

  constructor(code: LatexRenderErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type CompileFile = {
  name: string;
  base64: string;
};

/**
 * Circuit breaker around the external LaTeX render service. Without it, an
 * outage means every finalize request burns the full 20s timeout, exhausting
 * the serverless concurrency pool + Neon connections — one dependency failure
 * cascades into a total outage. After N consecutive INFRA failures (timeout /
 * unreachable / 5xx) the breaker opens and fast-fails for a cooldown window.
 * 4xx (bad LaTeX) does NOT trip it — that's a caller error, the service is up.
 */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;
const breaker = { failures: 0, openUntil: 0 };

// Integrity floor for a rendered PDF. The render service can answer 200 with an
// HTML error page or a truncated body; a real one-page resume PDF is tens of KB,
// so anything without the %PDF- header or under this size is corrupt.
const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
const MIN_PDF_BYTES = 1024;

function breakerIsOpen(): boolean {
  return Date.now() < breaker.openUntil;
}
function recordBreakerSuccess(): void {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordBreakerFailure(): void {
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_THRESHOLD) {
    breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    // Re-arm the count when opening. Keeping it meant the breaker was already
    // at the threshold when the cooldown expired, so the first probe failure
    // re-opened it and renders stayed broken long after the service recovered.
    // Clearing it gives the recovered service a full threshold of attempts.
    breaker.failures = 0;
  }
}

export async function compileLatexToPdf(tex: string, options?: { files?: CompileFile[]; timeoutMs?: number; engine?: "pdflatex" | "xelatex" }) {
  const timeoutMs = options?.timeoutMs ?? 20000;
  const url = process.env.LATEX_RENDER_URL;
  const token = process.env.LATEX_RENDER_TOKEN;
  if (!url || !token) {
    // Changed error code and message as per instruction, keeping original constructor argument order
    throw new LatexRenderError("LATEX_RENDER_CONFIG_MISSING", 503, "No render service configuration");
  }
  let renderHost: string;
  try {
    renderHost = parseSafeOutboundUrl(url).hostname;
  } catch (err) {
    // Name which check rejected the URL. Collapsing every parse failure into
    // one message left an operator with a 503 and no way to tell a plain-http
    // URL from a malformed one. The URL itself stays out of the payload: it
    // can carry a token in its path.
    throw new LatexRenderError(
      "LATEX_RENDER_CONFIG_MISSING",
      503,
      "Render service URL is invalid",
      err instanceof SafeOutboundError ? { reason: err.code } : undefined,
    );
  }

  // Fast-fail while the breaker is open instead of queueing behind a dead
  // dependency and holding the request/connection for the full timeout.
  if (breakerIsOpen()) {
    throw new LatexRenderError(
      "LATEX_RENDER_UNREACHABLE",
      503,
      "Render service temporarily unavailable (circuit open)",
    );
  }

  let res: Response;

  const body: Record<string, unknown> = { tex };
  if (options?.files?.length) {
    body.files = options.files;
  }
  if (options?.engine) {
    body.engine = options.engine;
  }

  try {
    res = await safeOutboundFetch(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": token,
        },
        body: JSON.stringify(body),
      },
      {
        allowedHosts: [renderHost],
        maxRedirects: 0,
        maxResponseBytes: 12 * 1024 * 1024,
        timeoutMs,
      },
    );
  } catch (err) {
    recordBreakerFailure(); // timeout / network failure = infra down
    if (
      (err as Error).name === "AbortError" ||
      (err instanceof SafeOutboundError && err.code === "REQUEST_TIMEOUT")
    ) {
      throw new LatexRenderError("LATEX_RENDER_TIMEOUT", 504, "Render request timed out");
    }
    throw new LatexRenderError("LATEX_RENDER_UNREACHABLE", 502, "Render service unreachable");
  }

  if (!res.ok) {
    // 5xx = service degraded -> count toward breaker. 4xx = bad input
    // (our LaTeX), service is healthy -> do not trip.
    if (res.status >= 500) recordBreakerFailure();
    const contentType = res.headers.get("content-type") ?? "";
    let details: unknown = undefined;
    if (contentType.includes("application/json")) {
      details = await res.json().catch(() => undefined);
    } else {
      const text = await res.text().catch(() => "");
      details = text ? { message: text.slice(0, 2000) } : undefined;
    }
    throw new LatexRenderError(
      "LATEX_RENDER_FAILED",
      res.status,
      `LATEX_RENDER_FAILED_${res.status}`,
      details,
    );
  }

  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.byteLength < MIN_PDF_BYTES || !pdf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    // A 200 with a non-PDF or truncated body means the render service is
    // misbehaving; fail loudly so a corrupt file never reaches storage or the
    // user. Content anomalies do not trip the infra breaker.
    throw new LatexRenderError(
      "LATEX_RENDER_FAILED",
      502,
      "Render service returned a non-PDF or truncated payload",
    );
  }
  recordBreakerSuccess();
  return pdf;
}
