# ADR-0014: Retire the browser extension for a local Runner

- **Status:** Accepted
- **Date:** 2026-07-31
- **Context owner:** Joblit Engineering
- **Supersedes:** ADR-0003 (Seek fetch via browser extension), ADR-0004 (hybrid
  local AI runtime), ADR-0012 (extension ingress and abuse budget)

## Context

The Chrome extension carried four jobs: issuing and holding the API token,
scraping Seek from the user's logged-in session, driving the local Hermes
gateway for tailoring and fit scanning, and autofilling ATS forms.

Each had eroded independently.

Seek fetching had already moved out of the server (ADR-0003) and then out of
reach entirely — the fetch-runs schema has pinned `source` to `jobspy` since,
and the only Seek code left was an on-demand JD refetch for jobs the extension
had imported with a teaser description.

The local-AI path (ADR-0004) put a probabilistic runtime behind a browser
extension, a service worker, a content-script bridge, a wire contract, and a
run registry — five hops, each with its own failure mode, to reach a gateway
listening on 127.0.0.1. The Jobs page told users to keep the tab open because
the scan died with it.

Autofill never reached the point where it saved more work than it cost, and the
ingress that protected it (ADR-0012) existed only because a browser extension
is an untrusted client.

Meanwhile the batch tailoring protocol (`AGENTS.md`) had been running headless
against Codex for months with no documented authentication at all — it borrowed
the browser's session cookie.

## Decision

Replace the extension with a local Runner: a dependency-free Node process that
speaks the public HTTP API with an agent token and calls the user's Hermes
gateway directly over loopback.

1. **Authentication becomes first-class.** `withAgentRoute` accepts either a
   Bearer agent token or a session cookie and produces the same
   `SessionContext`. A presented token is never rescued by a cookie, so
   revocation is immediate. Tokens are issued from `/agent`; the API that mints
   them is session-only, because minting a token from a token would let a leaked
   credential outlive its revocation.

2. **The Runner drains queues; the browser enqueues them.** Both fit scanning
   and tailoring already had server-side queues — the database leases fit
   batches, and the batch protocol claims tasks. The browser's only real job was
   the model call, and that moves to the Runner. The Jobs page now enqueues and
   watches counts.

3. **The Hermes key never reaches Joblit.** The Runner reads it from local
   environment and refuses to construct against a non-loopback base URL, so a
   typo in `HERMES_URL` fails loudly instead of exfiltrating the key.

4. **Submission is deferred, not reimplemented.** Autofill is deleted rather
   than ported. The `FormSubmission` model stays as the ledger a future
   agent-driven submission path will write to.

## Consequences

- Users install a Node process instead of a Chrome extension. That is a higher
  setup bar and a deliberate trade: the Runner works headless, survives a closed
  tab, and is inspectable.
- One protocol instead of two. External agents (Codex) and the first-party
  Runner are the same kind of client, authenticated the same way.
- A queue with no Runner running now sits still. The Jobs page reports that as
  waiting, with a link to setup — not as failure, because the work is queued and
  a Runner started later still picks it up.
- `ExtensionToken` keeps its name in the schema while serving agent tokens.
  Renaming it is a migration this ADR does not spend.
- `FieldMappingRule` and `LocalAiSetting` lose their writers and keep their
  tables, following ADR-0006.
- Seek-sourced jobs already in users' databases keep working: `seek.com.au`
  stays in the posting-risk neutral-host list and the `seek` fetch-lane label
  survives for stored receipts.
