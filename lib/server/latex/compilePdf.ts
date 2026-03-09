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

export async function compileLatexToPdf(tex: string, options?: { files?: CompileFile[]; timeoutMs?: number; engine?: "pdflatex" | "xelatex" }) {
  const timeoutMs = options?.timeoutMs ?? 20000;
  const url = process.env.LATEX_RENDER_URL;
  const token = process.env.LATEX_RENDER_TOKEN;
  if (!url || !token) {
    // Changed error code and message as per instruction, keeping original constructor argument order
    throw new LatexRenderError("LATEX_RENDER_CONFIG_MISSING", 503, "No render service configuration");
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
    if ((err as Error).name === "AbortError") {
      throw new LatexRenderError("LATEX_RENDER_TIMEOUT", 504, "Render request timed out");
    }
    throw new LatexRenderError("LATEX_RENDER_UNREACHABLE", 502, "Render service unreachable");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
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

  return Buffer.from(await res.arrayBuffer());
}
