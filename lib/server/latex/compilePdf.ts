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

  // Fast-fail while the breaker is open instead of queueing behind a dead
  // dependency and holding the request/connection for the full timeout.
  if (breakerIsOpen()) {
    throw new LatexRenderError(
      "LATEX_RENDER_UNREACHABLE",
      503,
      "Render service temporarily unavailable (circuit open)",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;

  const body: Record<string, unknown> = { tex };
  if (options?.files?.length) {
    body.files = options.files;
  }
  if (options?.engine) {
    body.engine = options.engine;
  }

  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": token,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    recordBreakerFailure(); // timeout / network failure = infra down
    if ((err as Error).name === "AbortError") {
      throw new LatexRenderError("LATEX_RENDER_TIMEOUT", 504, "Render request timed out");
    }
    throw new LatexRenderError("LATEX_RENDER_UNREACHABLE", 502, "Render service unreachable");
  } finally {
    clearTimeout(timeout);
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

  recordBreakerSuccess();
  return Buffer.from(await res.arrayBuffer());
}
