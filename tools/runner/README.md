# Joblit Runner

A headless local worker for the batch tailoring protocol. What Codex did
interactively — claim a task, generate the CV/CL, import the result — the
Runner does unattended, driving the official Codex CLI on your machine.

The Runner is not privileged. It talks to the same public HTTP API any
external agent uses (see [AGENTS.md](../../AGENTS.md)), authenticated with an
`AgentCredential`. It imports no repository code: the API is the contract.

## What it does

Each cycle it drains two queues. Fit scanning runs first — coarse triage is
cheap and narrows what is worth tailoring.

**Fit scan.** `POST /api/jobs/fit/next-batch` leases one durable, exact
`FitBatchClaim`; `/api/jobs/fit/prompt` binds its prompt receipt, the Runner
heartbeats the current attempt while the model scores it, and
`/api/jobs/fit/batch-import` records every Job as scored or failed. The prompt's
stable 64-hex `issueKey` is content-addressed from the Claim Job set and prompt
snapshot. The server writes a unique `FitBatchImportReceipt`, item outcomes,
Job projections, and terminal Claim in one transaction, so an exact retry
returns the original validated settlement. A definite failure is marked or
released; an unknown import outcome deliberately keeps the completed result
for replay. On restart, the Runner asks
`/api/jobs/fit/settlement-status` whether each completed issue committed before
forgetting it. The browser's Stop action calls `/api/jobs/fit/cancel`; claimed
work can finish locally, but its stale claim cannot import after cancellation,
and the next explicit scan can re-queue it.

**Tailoring batch.**

1. `GET /api/application-batches/active` — find the batch you queued from the
   Jobs page.
2. `POST /api/application-batches/:id/run-once` — claim one task, and report
   any failure from the previous round in the same call.
3. For each of the claimed task's `remainingTargets`, ask
   `POST /api/applications/prompt` for the prompt and its receipt, echoing the
   task's `protocolVersion`, `issueKey`, and batch/task/attempt identity.
4. Run the prompt through `codex exec` and wait for the output.
5. `POST /api/applications/manual-generate?finalize=true` — import the output
   with the receipt and Tailoring Run handle exactly as issued.
6. Repeat until the batch has nothing left to claim.

Success is never reported. The final import settles the task; only `FAILED`
and `SKIPPED` travel back through `run-once`.

While the model is running, the Runner polls Joblit's Tailoring Run. Every
non-terminal response must carry the exact issued `{ id, attemptId }`; a changed
attempt means another executor took over, so the Runner aborts local work and
does not import or fail the new attempt. If another task owns a live lease,
`run-once` returns `retryAfterMs` and the Runner waits and retries rather than
treating an empty claim as completion.

## Setup

Two credentials, both local.

**AgentCredential** — open the Runner setup popover in the Joblit nav (the plug
icon) and issue a credential. It is shown once: Joblit stores only its SHA-256
hash and cannot show the raw value again. The `jfagent_v1_` prefix,
`joblit-agent` audience, and explicit capabilities keep this trust domain
separate from browser sessions. **Regenerate** in the same popover revokes the
old credential before issuing its replacement, which stops a running Runner
immediately.

**Model access** — the official Codex CLI, signed in to your own ChatGPT
subscription. The Runner never holds an AI credential: `codex login` stores it,
and the child process inherits it.

```bash
npm i -g @openai/codex
codex login
```

Then the Runner's own two variables:

```bash
export JOBLIT_URL="https://your-joblit-deployment"
export JOBLIT_TOKEN="jfagent_v1_…"   # from the Runner setup popover
export CODEX_MODEL="gpt-5.6-terra"   # optional; unset uses the CLI default
export CODEX_BIN="/path/to/codex"    # optional; unset resolves from PATH
```

Every invocation is pinned to a text generator, never a coding agent:
`--sandbox read-only`, `features.shell_tool=false`, `web_search=disabled`,
`--ignore-user-config`, `--ignore-rules`, `--ephemeral`, and a throwaway
working directory. Job descriptions are untrusted text from the internet and
they go straight into the prompt, so the model gets no filesystem, no network,
and nothing of your personal Codex configuration.

## Running

Drain the active batch once and exit:

```bash
node tools/runner/cli.mjs
```

Keep polling for new batches every 5 seconds. Each cycle checks an explicit
application batch before background fit-scoring work:

```bash
node tools/runner/cli.mjs --watch
```

Typical loop: start a fit scan or select jobs and click **Generate CV & CL** in
the Jobs page, then leave the Runner running. Generated materials and their
PDFs land in Joblit for review; the Runner never submits an application.

A Codex run is a subprocess, so there is no local recovery state and no
`~/.joblit/runner-state-v1.json`. If the Runner dies mid-generation the child
dies with it: nothing was produced, nothing was imported, and the next run
simply claims the task again. Duplicate protection stays where it belongs —
server-side, on the content-addressed receipts.

The Runner still polls Joblit's Tailoring Run while the model works, and still
aborts local work if another executor takes the attempt over. What disappeared
is only the machinery for reconciling a _remote_ run object that could outlive
the local process.

## Failure handling

A task fails when Codex deterministically cannot produce output, or when
Joblit definitively rejects the content (for example a schema or receipt
mismatch that one permitted repair cannot fix). The Runner reports it as
`FAILED` with the server's own message on the next `run-once` and moves to the
next task; the batch finishes with the rest intact. Re-queue failed jobs from
the Jobs page.

Timeouts, transport loss, and retryable 408/425/429/5xx responses from Joblit
are deferred. A Tailoring import makes up to three total attempts with the
exact same receipt. A Fit import makes one exact replay (two total attempts)
with its stable issue and durable `FitBatchImportReceipt`. If the outcome is
still unknown the Runner does **not** report `FAILED` — the server receipt
decides on a later pass.

Common causes:

- `Missing required environment variables` — see Setup above.
- `CODEX_UNAVAILABLE` — the CLI is not on `PATH`; install it with
  `npm i -g @openai/codex` or point `CODEX_BIN` at it.
- `CODEX_FAILED` with an authentication message — run `codex login` again.
- `CODEX_TIMEOUT` — the model produced nothing within the run budget.
- `IMPORT_SETTLEMENT_UNKNOWN` — retry later; do not regenerate or mark the
  task failed.
- `Create your resume first` — no active `ResumeProfile` for the locale.

## Tests

```bash
npm run test:runner
```

Dependency-free Node with the built-in test runner, so it is excluded from
the Vitest project the same way the other `tools/` suites are. `clients.test.mjs`
pins the HTTP shapes with a fake `fetch`; `runner.test.mjs` pins the protocol
order with fake clients.
