/**
 * Local sidecar: lets the Joblit web app trigger a tailoring run on this machine.
 *
 * Joblit's server never calls a model and never holds a model credential
 * (ADR-0015), and Vercel cannot reach a laptop, so the browser talks to this
 * process directly on loopback. It reuses the same loop the CLI runs and the
 * same gates production runs — this only adds an HTTP door and streams
 * progress, because a generation takes tens of seconds and a button with no
 * feedback reads as broken.
 *
 *   node --env-file=.env --experimental-loader ./tools/evals/aliasLoader.mjs \
 *     tools/tailor/serve.mjs [--port 8791]
 *
 * On Windows, `tools/tailor/start-sidecar.cmd` runs exactly that by
 * double-click — a browser cannot launch this process itself, so the choice is
 * a shortcut or a typed command, not a button in the page.
 *
 * Scope, deliberately: this is a personal tool. It runs as the operator, uses
 * the database credentials already in .env, and binds to loopback only. There
 * is no per-request auth because there is no second user — anything that
 * changes that needs a real credential boundary first, not an afterthought.
 */
import { createServer } from "node:http";

import { prisma } from "@/lib/server/prisma";

import { generateTailoring } from "./generateTailoring.mjs";

const DEFAULT_PORT = 8791;

/**
 * The deployed app and a local dev server are the only pages meant to reach
 * this. Echoing back an arbitrary Origin would let any site in the browser
 * drive generation on this machine.
 */
const ALLOWED_ORIGINS = new Set([
  "https://www.joblit.tech",
  "https://joblit.tech",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(origin, req) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  const headers = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };
  // Private Network Access: a page served from a public origin reaching a
  // loopback address needs this granted explicitly, or Chrome fails the
  // request before it is sent — indistinguishable from the sidecar being
  // down. Only echoed for an origin already on the allowlist.
  if (req?.headers["access-control-request-private-network"] === "true") {
    headers["access-control-allow-private-network"] = "true";
  }
  return headers;
}

function send(res, status, body, origin, req) {
  res.writeHead(status, {
    "content-type": "application/json",
    ...corsHeaders(origin, req),
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      // A tailoring request is a job id and a target. Anything larger is not
      // one, and this process holds database credentials.
      if (size > 16 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handleGenerate(req, res, origin) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    send(res, 400, { ok: false, error: error.message }, origin, req);
    return;
  }

  const { jobId, target = "resume", locale = "en-AU", model } = body;
  if (typeof jobId !== "string" || !jobId) {
    send(res, 400, { ok: false, error: "jobId is required" }, origin, req);
    return;
  }
  if (target !== "resume" && target !== "cover") {
    send(res, 400, { ok: false, error: "target must be resume or cover" }, origin, req);
    return;
  }

  // Progress streams as newline-delimited JSON rather than SSE: the client is
  // a fetch reader, and one line per event needs no framing library on either
  // side.
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-store",
    ...corsHeaders(origin, req),
  });
  const emit = (event) => res.write(`${JSON.stringify(event)}\n`);

  try {
    const result = await generateTailoring({
      jobId,
      target,
      locale,
      model,
      onProgress: emit,
    });
    emit(
      result.ok
        ? {
            phase: "done",
            ok: true,
            attempts: result.attempts,
            target: result.target,
            // What the browser must submit to the import route: the raw
            // model output the gate accepted, not the derived aggregate.
            rawOutput: result.rawOutput,
            aiContent: result.aiContent,
            coverQualityGate: result.coverQualityGate,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          }
        : {
            phase: "done",
            ok: false,
            attempts: result.attempts,
            note: result.note,
            rejections: result.rejections,
          },
    );
  } catch (error) {
    emit({ phase: "done", ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
}

const port = Number(
  process.argv.includes("--port")
    ? process.argv[process.argv.indexOf("--port") + 1]
    : DEFAULT_PORT,
);

const server = createServer((req, res) => {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin, req));
    res.end();
    return;
  }
  // Lets the page tell "sidecar not running" apart from "sidecar refused", so
  // the button can say which.
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true, service: "joblit-tailor-sidecar" }, origin, req);
    return;
  }
  if (req.method === "POST" && req.url === "/generate") {
    void handleGenerate(req, res, origin);
    return;
  }
  send(res, 404, { ok: false, error: "not found" }, origin, req);
});

// Loopback only. This process can write to the database as the operator; it
// has no business being reachable from the network.
server.listen(port, "127.0.0.1", () => {
  process.stderr.write(`joblit tailor sidecar on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
