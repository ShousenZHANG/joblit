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
speaks the public HTTP API with an `AgentCredential` and calls the user's Hermes
gateway directly over loopback.

1. **Authentication becomes first-class and capability-scoped.**
   `withAgentRoute` accepts either a versioned `AgentCredential` or a session
   cookie and produces the same `SessionContext`. A route declares one of
   `fit:drain`, `tailoring:execute`, or `tailoring:control`; a credential
   without that capability is rejected. Version 1 credentials use prefix
   `jfagent_v1_` and audience `joblit-agent`. They are deliberately
   incompatible with the retired `jfext_` credentials. A presented Bearer
   credential is never rescued by a cookie, so revocation is immediate.
   Credentials are issued from `/agent`; the API that mints them is
   session-only, because minting a credential from a credential would let a
   leaked secret outlive its revocation.

2. **The Runner drains queues; the browser enqueues them.** Both fit scanning
   and tailoring already had server-side queues — the database leases fit
   batches, and the batch protocol claims tasks. The browser's only real job was
   the model call, and that moves to the Runner. The Jobs page now enqueues and
   watches counts. Fit prompts publish a content-addressed issue and settle
   through `FitBatchImportReceipt`; tailoring prompts publish a
   `{ TailoringRun.id, attemptId }` fence and settle through
   `TailoringRunReceipt`. Unknown network outcomes replay the same receipt and
   never become synthetic failures.

3. **The Hermes key never reaches Joblit.** The Runner reads it from local
   environment and refuses to construct against a non-loopback base URL, so a
   typo in `HERMES_URL` fails loudly instead of exfiltrating the key.

4. **Submission is deferred, not reimplemented.** Autofill is deleted rather
   than ported. `FormSubmission`, `FieldMappingRule`, and `LocalAiSetting` are
   also removed: their schemas described the retired browser client and are not
   a valid contract for a future agent-driven submission ledger.

## Consequences

- Users install a Node process instead of a Chrome extension. That is a higher
  setup bar and a deliberate trade: the Runner works headless, survives a closed
  tab, and is inspectable.
- One protocol instead of two. External agents (Codex) and the first-party
  Runner are the same kind of client, authenticated the same way.
- A queue with no Runner running now sits still. The Jobs page reports that as
  waiting, with a link to setup — not as failure, because the work is queued and
  a Runner started later still picks it up.
- A claimed tailoring task whose lease is still live returns a bounded retry
  hint. The Runner waits instead of interpreting an empty claim as completion,
  and aborts local work if Tailoring Run polling shows a different attempt.
- Hermes state is machine-local, contains no prompt/output/credential bytes,
  and remains until Joblit proves the receipt was accepted or the server run is
  terminal without that target. `stopping` is non-terminal; interrupted repair
  turns are recovered from one unambiguous transcript response rather than
  repeated.
- `AgentCredential` is a separate model and trust domain, not a rename-only
  reuse of `ExtensionToken`. It records credential version, audience,
  capabilities, expiry, revocation, and last use; only a SHA-256 hash is stored.
  Existing `jfext_` tokens are not accepted by agent routes. The expand
  deployment retained the retired table while old instances drained; the
  separately released
  `20260731140000_drop_extension_token_and_legacy_artifact_uniques` contract
  migration then dropped `ExtensionToken`, which is not part of the target
  model.
- `FieldMappingRule`, `LocalAiSetting` and `FormSubmission` were dropped
  outright in `20260731120000_drop_extension_and_career_tables`, together with
  the Career-workspace tables ADR-0006 had deferred. The decision was taken
  against measured row counts: `InterviewPlan`, `StarStory` and `Offer` were
  empty, so the user content that deferral protected had never been written.
  `FormSubmission` held 500 rows of ATS form values — personal data with no
  reader, which is a liability rather than an asset. A future submission ledger
  should be modelled for the agent path, not revived from the autofill shape.
- Seek-sourced jobs already in users' databases keep working: `seek.com.au`
  stays in the posting-risk neutral-host list and the `seek` fetch-lane label
  survives for stored receipts.
