# Joblit Runner

A headless local worker for the batch tailoring protocol. What Codex did
interactively — claim a task, generate the CV/CL, import the result — the
Runner does unattended against your own Hermes gateway on loopback.

The Runner is not privileged. It talks to the same public HTTP API any
external agent uses (see [AGENTS.md](../../AGENTS.md)), authenticated with an
agent token. It imports no repository code: the API is the contract.

## What it does

Each cycle it drains two queues. Fit scanning runs first — coarse triage is
cheap and narrows what is worth tailoring.

**Fit scan.** `POST /api/jobs/fit/next-batch` leases a batch of unscored jobs,
`/api/jobs/fit/prompt` returns the triage prompt, Hermes scores it, and
`/api/jobs/fit/batch-import` records the verdicts. A batch is never left
leased: it imports, or it is marked failed, or its claim is released.

**Tailoring batch.**

1. `GET /api/application-batches/active` — find the batch you queued from the
   Jobs page.
2. `POST /api/application-batches/:id/run-once` — claim one task, and report
   any failure from the previous round in the same call.
3. For each of the claimed task's `remainingTargets`, ask
   `POST /api/applications/prompt` for the prompt and its receipt.
4. Run the prompt through Hermes and wait for the output.
5. `POST /api/applications/manual-generate?finalize=true` — import the output
   with the receipt and Tailoring Run handle exactly as issued.
6. Repeat until the batch has nothing left to claim.

Success is never reported. The final import settles the task; only `FAILED`
and `SKIPPED` travel back through `run-once`.

## Setup

Two credentials, both local.

**Agent token** — on the Joblit `/extension` page, generate a token and copy
it once. It is stored hashed; Joblit cannot show it again. Revoke it from the
same page. (The issuing UI moves off the extension page when the extension is
removed; the token itself and its API are unaffected.)

**Hermes key** — from your local Hermes gateway configuration. It never
touches Joblit: the Runner reads it from your environment and sends it only to
the loopback gateway. `hermesClient` refuses to construct against any
non-loopback base URL, so a typo in `HERMES_URL` fails loudly instead of
mailing your key to a stranger.

```bash
export JOBLIT_URL="https://your-joblit-deployment"
export JOBLIT_TOKEN="jfext_…"      # from /extension
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
the Jobs page, then leave the Runner running. Materials land as drafts —
nothing is submitted anywhere, and nothing is sent without your review.

## Failure handling

A task fails when Hermes cannot produce output, or when Joblit rejects the
import (schema violation, receipt mismatch, stale attempt). The Runner reports
it as `FAILED` with the server's own message on the next `run-once` and moves
to the next task; the batch finishes with the rest intact. Re-queue failed
jobs from the Jobs page.

Common causes:

- `Missing required environment variables` — see Setup above.
- `Hermes gateway must be loopback` — `HERMES_URL` points off-machine.
- `fetch failed` against `127.0.0.1:8642` — the gateway is not running.
- `Create your resume first` — no active `ResumeProfile` for the locale.

## Tests

```bash
npm run test:runner
```

Dependency-free Node with the built-in test runner, so it is excluded from
the Vitest project the same way the other `tools/` suites are. `clients.test.mjs`
pins the HTTP shapes with a fake `fetch`; `runner.test.mjs` pins the protocol
order with fake clients.
