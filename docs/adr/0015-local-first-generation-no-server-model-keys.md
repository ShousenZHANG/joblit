# ADR-0015: Generation is local-first; the server holds no model key

- **Status:** Accepted
- **Date:** 2026-08-02
- **Context owner:** Joblit Engineering

## Context

Two hosting ideas were evaluated and rejected in quick succession: deploying a
shared Hermes gateway for all users (one ChatGPT account carrying everyone's
load — account-sharing against provider terms, single-tenant software, the
operator's account as a single point of ban), and a per-user variant where
each user completes OAuth into processes on the operator's droplet (the
operator custodies everyone's OpenAI session tokens and resume transcripts —
strictly worse for users). Both also required deleting the Runner's
loopback-only guard, whose whole purpose is preventing the Hermes key from
leaving the user's machine.

Meanwhile the repository still carried a third generation engine: a
feature-gated server path (`/api/application-batches/[id]/execute` →
`executeServerBatchTailoringTask` → Gemini) that had never been enabled in
production. Every capability it promised is served by paths that already
exist: the Runner automates generation with the user's own model, and the
manual external-model import (copy prompt → run anywhere → paste JSON) is the
zero-install path.

## Decision

Generation runs where the user's model runs. The server issues prompts,
validates output through the quality gates, and persists results — it never
calls a model and never holds a model credential.

The Gemini chain is deleted: the `/execute` route, the server batch executor,
`ai/tailorApplication`, the provider client and defaults, the `gemini` and
`batchAutogeneration` runtime capabilities, and the `GEMINI_API_KEY`,
`GEMINI_MODEL`, `ENABLE_BATCH_EXECUTE_AUTOGEN` environment variables.
`test/architecture/legacyApplicationGenerateRoute.test.ts` now pins every
retired server-side generation surface to non-existence.

## Consequences

- Two generation paths remain, both user-owned: the Runner (automated, local
  Hermes, loopback-only) and manual import (zero-install, any model).
- Privacy claim becomes unconditional: no resume or JD content is ever sent to
  a model by Joblit's servers, because the servers cannot.
- There is no zero-effort server generation for users who will not run
  anything locally; the manual path is their floor. Revisiting that means
  revisiting this ADR, not quietly re-adding a key.
- Hermes stays what it is designed to be: personal, local, one profile per
  human. Any future shared hosting of it is out of scope for this product.
