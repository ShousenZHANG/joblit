# Joblit Runner

A headless local worker for the batch tailoring protocol. What Codex did
interactively — claim a task, generate the CV/CL, import the result — the
Runner does unattended against your own Hermes gateway on loopback.

The Runner is not privileged. It talks to the same public HTTP API any
external agent uses (see [AGENTS.md](../../AGENTS.md)), authenticated with an
`AgentCredential`. It imports no repository code: the API is the contract.

## What it does

Each cycle it drains two queues. Fit scanning runs first — coarse triage is
cheap and narrows what is worth tailoring.

**Fit scan.** `POST /api/jobs/fit/next-batch` leases one durable, exact
`FitBatchClaim`; `/api/jobs/fit/prompt` binds its prompt receipt, the Runner
heartbeats the current attempt while Hermes scores it, and
`/api/jobs/fit/batch-import` records every Job as scored or failed. The prompt's
stable 64-hex `issueKey` is content-addressed from the Claim Job set and prompt
snapshot. The server writes a unique `FitBatchImportReceipt`, item outcomes,
Job projections, and terminal Claim in one transaction, so an exact retry
returns the original validated settlement. A definite failure is marked or
released; an unknown import outcome deliberately keeps completed Hermes state
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
4. Run the prompt through Hermes and wait for the output.
5. `POST /api/applications/manual-generate?finalize=true` — import the output
   with the receipt and Tailoring Run handle exactly as issued.
6. Repeat until the batch has nothing left to claim.

Success is never reported. The final import settles the task; only `FAILED`
and `SKIPPED` travel back through `run-once`.

While Hermes is running, the Runner polls Joblit's Tailoring Run. Every
non-terminal response must carry the exact issued `{ id, attemptId }`; a changed
attempt means another executor took over, so the Runner aborts local work and
does not import or fail the new attempt. If another task owns a live lease,
`run-once` returns `retryAfterMs` and the Runner waits and retries rather than
treating an empty claim as completion.

## Setup

Two credentials, both local.

**AgentCredential** — on the Joblit `/agent` page, issue a version 1
credential and copy it once. Joblit stores only its SHA-256 hash and cannot
show the raw value again. The `jfagent_v1_` prefix, `joblit-agent` audience,
and explicit capabilities keep this trust domain separate from browser
sessions. Revoke the credential from the same page to stop the Runner
immediately.

**Hermes key** — from your local Hermes gateway configuration. It never
touches Joblit: the Runner reads it from your environment and sends it only to
the loopback gateway. `hermesClient` refuses to construct against any
non-loopback base URL, so a typo in `HERMES_URL` fails loudly instead of
mailing your key to a stranger.

```bash
export JOBLIT_URL="https://your-joblit-deployment"
export JOBLIT_TOKEN="jfagent_v1_…" # from /agent
export HERMES_KEY="…"              # from your local gateway
export HERMES_URL="http://127.0.0.1:8642"   # optional, this is the default
```

## Running

Drain the active batch once and exit:

```bash
node tools/runner/cli.mjs
```

Keep polling for new batches every 30 seconds:

```bash
node tools/runner/cli.mjs --watch
```

Typical loop: start a fit scan or select jobs and click **Generate CV & CL** in
the Jobs page, then leave the Runner running. Generated materials and their
PDFs land in Joblit for review; the Runner never submits an application.

Hermes recovery metadata is stored at
`~/.joblit/runner-state-v1.json`. It is deliberately **machine-local**:
multiple Runner processes on that machine serialize updates through an atomic
compare-and-set guarded by a `.lock` sidecar, with bounded waiting and
owner-checked recovery of locks left by crashed processes. Do not place the
state file on a network share or reuse it across
hosts. The file contains only opaque run/session ids, hashes, a repair
transcript cursor, and strict non-secret operation identity (Tailoring Run id,
attempt id, target, and prompt hash); prompts, feedback text, model output,
resume content, `JOBLIT_TOKEN`, and `HERMES_KEY` are never persisted.

At startup the Runner reconciles starting/running/completed/repairing local
operations with Joblit before claiming new work. An accepted target receipt
authorizes local acknowledgement and cleanup; a terminal server run without
that target authorizes discarding a terminal obsolete result; an exact active
attempt keeps the state for recovery; and malformed, unavailable, or mismatched
server state is preserved and fails closed. A known live private run is stopped
and observed terminal before cleanup; a `starting` reservation is cleared only
when its transcript proves one unique terminal turn. A separate Fit receipt
scan applies the same proof boundary to starting, running, and completed
content-addressed issues after Joblit proves settlement or terminality.

Hermes `stopping` means only that `/stop` accepted the request. It is not a
terminal state, so the private `run_*` id remains recoverable and a restart
polls that same run instead of starting duplicate work. If a one-turn repair is
interrupted after submission, the Runner reads the Hermes session transcript
and accepts only one unambiguous terminal assistant response. A tool-call or
non-terminal assistant row cannot qualify by itself; a completed tool sequence
is recoverable only through one later unique terminal `finish_reason: "stop"`
response with no trailing assistant/tool row. The Runner never repeats an
uncertain turn. Local cleanup is best effort after Joblit has
accepted a receipt and cannot reverse that authoritative settlement.

## Failure handling

A task fails when Hermes deterministically cannot produce output, or when
Joblit definitively rejects the content (for example a schema or receipt
mismatch that one permitted repair cannot fix). The Runner reports it as
`FAILED` with the server's own message on the next `run-once` and moves to the
next task; the batch finishes with the rest intact. Re-queue failed jobs from
the Jobs page.

Timeouts, transport loss, and retryable 408/425/429/5xx responses from Joblit
or Hermes are deferred. An unknown Hermes start or status outcome is also
deferred because the model may still be running. A Tailoring import makes up to three total
attempts with the exact same receipt. A Fit import makes one exact replay (two
total attempts) with its stable issue and durable `FitBatchImportReceipt`. If
the outcome is still unknown, the Runner leaves Hermes state recoverable and
does **not** report `FAILED`. A later startup reconciles the server receipt
before doing more model work.

Common causes:

- `Missing required environment variables` — see Setup above.
- `Hermes gateway must be loopback` — `HERMES_URL` points off-machine.
- `HERMES_REQUEST_TIMEOUT` or a connection error against `127.0.0.1:8642` —
  the gateway is unavailable or did not answer within the request budget.
- `IMPORT_SETTLEMENT_UNKNOWN` — keep the Runner state file and retry later; do
  not regenerate or mark the task failed.
- `Create your resume first` — no active `ResumeProfile` for the locale.

## Tests

```bash
npm run test:runner
```

Dependency-free Node with the built-in test runner, so it is excluded from
the Vitest project the same way the other `tools/` suites are. `clients.test.mjs`
pins the HTTP shapes with a fake `fetch`; `runner.test.mjs` pins the protocol
order with fake clients.
