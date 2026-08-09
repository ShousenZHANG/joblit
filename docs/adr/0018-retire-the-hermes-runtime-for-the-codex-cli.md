# ADR-0018: Retire the Hermes runtime for the Codex CLI

- **Status:** Accepted
- **Date:** 2026-08-09
- **Context owner:** Joblit Engineering
- **Supersedes:** ADR-0016 (Hermes transcript recovery), and the Hermes
  execution clauses of ADR-0014 and ADR-0015
- **Reverses:** ADR-0004's rejection of the `codex_app_server` runtime — see
  "The ADR-0004 reversal" below

## Context

ADR-0014 moved local execution out of a browser extension and into a Node
Runner. It kept the engine underneath unchanged: the Runner spoke HTTP to a
Hermes gateway the user had installed and bound to `127.0.0.1`.

Keeping that gateway cost more than it returned.

The user-visible setup was a PowerShell bootstrap, a signed profile package, a
model API key in local environment, a port to bind, and a process to keep
alive — all before the first CV could be generated. Every one of those was a
place to fail, and the failures were reported as Joblit failures.

The durability story was worse. A Hermes run is a _remote_ object: it outlives
the process that started it, so a Runner that died mid-generation had to
reconcile against something still running. ADR-0016 is the machinery that made
that safe — a local state file, a transcript cursor, compare-and-set
reservations, and a proof rule for recovering a lost start. Roughly two
thousand lines existed to answer a question the product did not need to ask.

Meanwhile the thing users actually had was a Codex CLI subscription. `codex
exec` is non-interactive, takes a prompt on stdin, holds its own login, and —
decisively — is a **child process**. If it dies, it is gone.

## Decision

The Runner generates by running the official Codex CLI as a child process. The
Hermes gateway is removed from the runtime path entirely.

1. **No model credential anywhere in Joblit.** `codex login` stores the user's
   own subscription auth; the child process inherits it. The Runner's only
   secret is the Joblit `AgentCredential`. `HERMES_URL`, `HERMES_KEY`, and the
   loopback-only guard that protected them are gone because there is nothing
   left to protect. Required Runner configuration is exactly `JOBLIT_URL` and
   `JOBLIT_TOKEN` (`tools/runner/config.mjs`).

2. **The model is pinned to a text generator, not an agent.** Every invocation
   selects `gpt-5.6-sol` with `model_reasoning_effort=max` and passes
   `--strict-config`, `--sandbox read-only`, `features.shell_tool=false`,
   `web_search=disabled`, `--ignore-user-config`, `--ignore-rules`,
   `--ephemeral`, and a throwaway working directory
   (`tools/runner/codexClient.mjs`). Job descriptions are untrusted text from
   the internet and they go straight into the prompt, so the model gets no
   filesystem, no network, and nothing of the user's personal Codex
   configuration. This is the direct descendant of ADR-0004's reasoning about
   not handing a probabilistic agent control over anything that matters.

3. **Local recovery state is deleted, not ported.** There is no
   `~/.joblit/runner-state-v1.json`. A dead Runner means a dead child, which
   means nothing was produced and nothing was imported; the next run claims the
   task again. Duplicate protection stays where it was always authoritative —
   server-side, on the content-addressed receipts (`FitBatchImportReceipt`,
   `TailoringRunReceipt`, and the exact attempt fence).

4. **The server contract does not change.** The Runner remains an ordinary
   client of the public HTTP API documented in `AGENTS.md`, authenticated by a
   capability-scoped `AgentCredential`. ADR-0015 still holds in full: the
   server issues prompts and accepts output, and never calls a model.

## The ADR-0004 reversal

ADR-0004 explicitly rejected the `codex_app_server` runtime, on the grounds
that its Codex-native `shell` and `apply_patch` tools remain exposed even when
Hermes toolsets are empty, and it required `model.openai_runtime: auto` as a
guardrail.

That rejection was reversed in practice by the Hermes bootstrap, which rewrites
local configuration to `openai_runtime: codex_app_server` and fails
verification if it is anything else
(`tools/hermes/bootstrap/JoblitHermes.Common.psm1`). No ADR recorded the
reversal at the time. This ADR records it.

The rejection no longer binds the runtime path, because the runtime it governed
does not exist: Joblit configures no Hermes install and reads no
`openai_runtime`. The underlying _concern_ is not dismissed — it is answered
differently, by decision 2 above, which strips the tools at the CLI boundary
instead of trusting a runtime setting.

## Consequences

- Setup drops from "install and bootstrap a gateway, mint a key, bind a port"
  to `npm i -g @openai/codex`, `codex login`, and one copyable start command
  from the Runner setup popover.
- ADR-0016 is superseded. Its Fit-queue durability decisions (durable
  `FitBatchClaim` leases, receipt uniqueness, cancellation semantics) survive
  in the database and remain in force; only its Hermes recovery mechanism
  (section 5) is retired.
- Joblit is now coupled to one specific CLI's argument surface. That is a real
  new dependency — a breaking change in `codex exec` breaks generation — and it
  is accepted because the alternative was a five-hop local stack. The seam is
  narrow: `codexClient.mjs` exposes `generate()` and nothing else, so a second
  engine is a sibling module, not a rewrite.
- Windows needs a shim. npm installs `codex.cmd`, and Node has refused to spawn
  `.cmd` directly since the 2024 command-injection fix, so invocations route
  through `cmd.exe /d /s /c` with `windowsVerbatimArguments` and an explicit
  rejection of any argument containing a quote or newline.
- **Open, deliberately not decided here:** the Hermes surface still in the
  repository — `tools/hermes/**`, `integrations/hermes/profile/**`,
  `tools/runner/hermesClient.mjs`, and `tools/runner/runStateStore.mjs` — has
  no runtime consumer at HEAD, but CI still builds, signs, and tests it, and
  `tools/runner/clients.test.mjs` keeps the two dead Runner modules reachable.
  Deleting it is a separate change with its own CI and workflow edits. Until
  that lands, this ADR is the authority on what actually executes, and the
  presence of that tree is not evidence that Hermes is live.
