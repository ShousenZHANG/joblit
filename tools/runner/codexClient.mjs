/**
 * Local model access through the official OpenAI Codex CLI.
 *
 * This replaces the Hermes gateway client. The job Joblit needs doing is
 * narrow — one prompt in, one text completion out, on the user's own ChatGPT
 * subscription — and `codex exec` does exactly that as a subprocess. No
 * gateway to install, no port to bind, no API key to hold: `codex login`
 * already stored the credential and the child process inherits it.
 *
 * Every invocation is hardened down to "text generator":
 *
 * - `--sandbox read-only` (the exec default, passed explicitly so a future
 *   default change cannot silently widen it) plus `features.shell_tool=false`
 *   removes the coding-agent surface. This is what ADR-0004 objected to in the
 *   app-server runtime, and the objection was correct: job descriptions are
 *   untrusted text fetched from the internet and they go straight into the
 *   prompt.
 * - `web_search=disabled` — search is on by default. A resume must be written
 *   from the user's own profile, not from whatever the model finds, and the
 *   profile must not travel to a search backend.
 * - `--ignore-user-config` / `--ignore-rules` — the user's personal
 *   `config.toml` and any `AGENTS.md` in scope must not change what Joblit
 *   generates.
 * - `--ephemeral` plus a throwaway working directory — no session files, and
 *   nothing of the user's filesystem in reach even for reading.
 *
 * There is deliberately no `--output-schema`: the server owns the output
 * contract, issues the prompt that states it, and validates what comes back.
 * Duplicating that schema here would create a second source of truth that
 * could drift.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** Matches the server's own ceiling for an imported model output. */
const MAX_MODEL_OUTPUT_CHARS = 200_000;
const STDERR_TAIL_CHARS = 2_000;

export class CodexClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CodexClientError";
    this.code = code;
  }
}

/**
 * Flags that make Codex behave as a plain completion endpoint. Order is
 * irrelevant to the CLI but kept stable for readable process listings.
 */
function buildArgs({ model, workdir, outPath }) {
  const args = [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--cd",
    workdir,
    "-c",
    "web_search=disabled",
    "-c",
    "features.shell_tool=false",
  ];
  if (model) args.push("-m", model);
  // The final assistant message goes to a file. stdout also carries a banner
  // and progress lines, so it is not a parseable transport.
  args.push("-o", outPath, "-");
  return args;
}

/**
 * Windows installs the Codex CLI as a `codex.cmd` shim, and Node has refused
 * to execute `.cmd`/`.bat` directly since the 2024 command-injection fix — a
 * bare spawn fails with EINVAL, or ENOENT for the extensionless shell script
 * beside it. The documented way to run a shim is through the command
 * processor, so on Windows the real invocation becomes:
 *
 *   cmd.exe /d /s /c "\"codex\" \"exec\" \"--sandbox\" ..."
 *
 * Every token is quoted here rather than left to the shell's own splitting,
 * because a temp path or an install directory may contain spaces. The prompt
 * is never a token: it travels on stdin, so no untrusted text reaches a
 * command line.
 */
function toWindowsShimInvocation(binary, args) {
  const tokens = [binary, ...args];
  const unsafe = tokens.find((token) => /["\r\n]/.test(token));
  if (unsafe !== undefined) {
    throw new CodexClientError(
      "CODEX_ARG_UNSAFE",
      `Refusing to build a Windows command line containing a quote or newline: ${unsafe}`,
    );
  }
  const quoted = tokens.map((token) => `"${token}"`).join(" ");
  return {
    file: process.env.ComSpec || "cmd.exe",
    // /d skips AutoRun scripts, /c runs and exits, and /s makes cmd strip
    // exactly the first and last quote of what follows — hence the extra
    // outer pair around an already-quoted command line.
    args: ["/d", "/s", "/c", `"${quoted}"`],
    // Without this Node escapes our quotes into \" while building the real
    // command line, and cmd then looks for a program literally named
    // `\"codex\"`. Verbatim hands the string over untouched, which is the
    // whole reason we quoted every token ourselves above.
    windowsVerbatimArguments: true,
  };
}

export function createCodexClient({
  binary = "codex",
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  platform = process.platform,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Codex timeout must be a positive integer");
  }

  async function runOnce({ prompt, signal }) {
    const workdir = await mkdtemp(path.join(tmpdir(), "joblit-codex-"));
    const outPath = path.join(workdir, "output.txt");
    try {
      const codexArgs = buildArgs({ model, workdir, outPath });
      const invocation =
        platform === "win32"
          ? toWindowsShimInvocation(binary, codexArgs)
          : { file: binary, args: codexArgs };
      const child = spawnImpl(invocation.file, invocation.args, {
        cwd: workdir,
        stdio: ["pipe", "pipe", "pipe"],
        ...(invocation.windowsVerbatimArguments
          ? { windowsVerbatimArguments: true }
          : {}),
      });

      // The prompt travels on stdin (the trailing `-` argument), so it never
      // appears in the process command line where another local process could
      // read it.
      child.stdin?.on("error", () => {
        /* EPIPE when the child exits before reading; surfaced via exit code */
      });
      child.stdin?.end(prompt);

      let stderr = "";
      let stdout = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS);
      });
      // Drained, not parsed: an unread pipe fills its buffer and stalls the
      // child once output exceeds it.
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-STDERR_TAIL_CHARS);
      });

      const settled = await new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener?.("abort", onAbort);
          resolve(result);
        };
        const kill = () => {
          // SIGTERM lets the CLI close its own transcript; the process is
          // ephemeral either way, so nothing survives to reconcile.
          try {
            child.kill("SIGTERM");
          } catch {
            /* already gone */
          }
        };
        const timer = setTimeout(() => {
          kill();
          finish({ kind: "timeout" });
        }, timeoutMs);
        const onAbort = () => {
          kill();
          finish({ kind: "aborted" });
        };
        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener?.("abort", onAbort, { once: true });
        }
        child.once("error", (error) => finish({ kind: "spawn-error", error }));
        child.once("close", (code) => finish({ kind: "closed", code }));
      });

      if (settled.kind === "aborted") {
        throw new CodexClientError("CODEX_ABORTED", "Codex run was cancelled");
      }
      if (settled.kind === "timeout") {
        throw new CodexClientError(
          "CODEX_TIMEOUT",
          `Codex produced no result within ${timeoutMs}ms`,
        );
      }
      if (settled.kind === "spawn-error") {
        const reason = settled.error?.code === "ENOENT"
          ? `Codex CLI not found on PATH (looked for "${binary}"). Install it with: npm i -g @openai/codex`
          : (settled.error?.message ?? "Codex could not be started");
        throw new CodexClientError("CODEX_UNAVAILABLE", reason);
      }
      if (settled.code !== 0) {
        throw new CodexClientError(
          "CODEX_FAILED",
          `Codex exited with code ${settled.code}: ${(stderr || stdout).trim() || "no diagnostics"}`,
        );
      }

      let output;
      try {
        output = await readFile(outPath, "utf8");
      } catch {
        throw new CodexClientError(
          "CODEX_NO_OUTPUT",
          "Codex exited successfully but wrote no final message",
        );
      }
      const trimmed = output.trim();
      if (trimmed.length === 0) {
        throw new CodexClientError(
          "CODEX_NO_OUTPUT",
          "Codex returned an empty final message",
        );
      }
      if (trimmed.length > MAX_MODEL_OUTPUT_CHARS) {
        throw new CodexClientError(
          "CODEX_OUTPUT_TOO_LARGE",
          `Codex returned ${trimmed.length} characters, above the ${MAX_MODEL_OUTPUT_CHARS} import ceiling`,
        );
      }
      return trimmed;
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    /**
     * One completion. `sessionId` and `operation` are accepted for parity with
     * the batch runner's call site and used only in diagnostics: a Codex run
     * is ephemeral, so there is no remote session to resume or fence.
     */
    async generate({ instructions, input, sessionId, signal }) {
      if (
        typeof instructions !== "string" ||
        instructions.length === 0 ||
        typeof input !== "string" ||
        input.length === 0
      ) {
        throw new CodexClientError(
          "RUN_REQUEST_INVALID",
          "Codex generation request is invalid",
        );
      }
      try {
        return await runOnce({ prompt: `${instructions}\n\n${input}`, signal });
      } catch (error) {
        if (error instanceof CodexClientError && sessionId) {
          error.message = `${error.message} (${sessionId})`;
        }
        throw error;
      }
    },

    /**
     * No-op. The Hermes client cleaned up a remote run here; a Codex run left
     * nothing behind — the process is gone and its working directory with it.
     * The batch runner calls this unconditionally after a successful import.
     */
    async acknowledge() {},
  };
}
