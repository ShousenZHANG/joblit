# ADR-0004: Use a hybrid local AI runtime for Joblit

- **Status:** Proposed; architecture selected, written spec pending user review
- **Date:** 2026-07-15
- **Context owner:** Joblit Engineering

## Context

Joblit needs a primary AI path that keeps users inside the product, can use the user's own ChatGPT-connected local Hermes runtime, supports local career memory, and does not give a probabilistic agent control over authentication, persistence, scoring, or final submission.

The existing product already owns user-scoped Jobs, Master Resume Profiles, `DRAFT`/`FINAL` Applications, AI provenance, strict Skill Pack contracts, PDF rendering, extension tokens, and ATS autofill. Hermes can supply local model inference and memory, while the Chrome extension can reach both Joblit and loopback services.

## Decision

Use a hybrid local-first architecture:

- Joblit remains the deterministic system of record and policy engine. Hermes performs probabilistic classification; Joblit validates, calculates, and enforces.
- One local Hermes profile per Joblit account (`joblit-<opaqueTenantHash>`) performs bounded AI reasoning and derived preference projection.
- The Chrome extension is the only bridge between Joblit AI tasks and loopback Hermes.
- The web page sends only task coordination data to the extension. It never receives the Joblit extension token, Hermes token, or ChatGPT credentials.
- Joblit validates schemas, evidence references, task state, ownership, revisions, and score arithmetic before persistence.
- New-path AI-generated Application content always enters the `DRAFT` -> Edit -> Finalize lifecycle with materialized evidence snapshots.
- Manual Skill Pack, optional provider APIs, and current Codex Batch remain labelled legacy exceptions during migration. They must reach canonical evidence and `DRAFT` parity before master-program acceptance.
- When accepted and Phase 4 migration ships, this ADR supersedes ADR-0002 only for Codex Batch immediate-`finalize=true` semantics. Other ADR-0002 Generate -> Edit -> Finalize decisions remain active.

The full contracts, capability model, security controls, rollout phases, and acceptance criteria live in [AI-Native Joblit Platform Design](../superpowers/specs/2026-07-15-ai-native-joblit-platform-design.md).

## Alternatives considered

### Hermes owns the workflow

Hermes would read and write Joblit data directly and decide persistence and workflow transitions.

**Rejected:** this grants a probabilistic local agent excessive authority, weakens auditability, and couples the product to Hermes internals.

### Cloud AI is the only path

Joblit would call a platform or user-supplied model API from the server.

**Rejected as the only path:** it cannot directly use each user's ChatGPT-connected local runtime, moves credential/cost responsibility into Joblit, and loses the intended local-memory boundary. It remains a fallback option.

### Keep manual prompt and JSON copy/paste as the primary path

**Rejected:** it is operationally reliable but creates a fragmented, high-friction user experience and prevents coherent task progress, recovery, and learning.

## Consequences

### Positive

- Cohesive Joblit UX with local credentials and a rebuildable local memory projection.
- Deterministic authorization, scoring, validation, persistence, and Finalize.
- Reuse of the existing extension and Application lifecycle.
- A versioned task boundary allows a future local runtime without rewriting product logic.

### Negative

- Requires compatible releases across Joblit, the extension, and Hermes.
- Local runtime discovery, authentication, version checking, and recovery become product responsibilities.
- Browser extension service-worker suspension requires durable server task state.

## Guardrails

- Hermes Joblit mode binds to loopback, rejects public bind, verifies the account-specific profile/home fingerprint, and requires a route-scoped token.
- Joblit signs a maximum-five-minute Compact JWS EdDSA execution grant binding task, idempotency key, action, account/profile, tool policy, memory scope, Skill hash, RFC 8785 input hash, expiry, and nonce. Hermes trusts only preinstalled Joblit public keys, consumes grants through a persistent atomic replay ledger, and derives policy from the verified grant; the extension cannot request more authority.
- Hermes deterministically preloads the requested Skill and returns server-attested name, version, and SHA-256. Model self-report is not accepted.
- Generation uses a server-enforced `joblit-generation-readonly` tool policy. Terminal, arbitrary filesystem, browser, code execution, skill/session management, cron, and memory writes are unavailable.
- Only an explicit learning action using a separate `joblit-learning` policy may update the user-confirmed derived-memory projection.
- Generation sets `persistSession: false`; raw Candidate/Job prompts, results, tool traces, and caches are not retained in Hermes state, history, or logs.
- Chrome storage is restricted to `TRUSTED_CONTEXTS`; Joblit and Hermes tokens are never readable by the page or content scripts.
- External extension messaging is limited to exact Joblit origins and typed, expiring task coordination messages.
- Candidate and Job evidence uses materialized, content-addressed snapshots before any personal-data vertical slice is persisted.
- AI task writes use idempotent Hermes runs, durable server task state, installation leases, and a strong integer `applicationRevision`; `aiContentHash` remains a non-security UX hint.
- Resume and cover have independent artifact states. Aggregate `Application.status` cannot become `FINAL` while a requested artifact remains `DRAFT`.
- Feedback corrections/deletions use override or tombstone events so memory rebuild cannot restore removed entries.
- AI output cannot directly mark an Application `FINAL` or submit a job-board form.

## Implementation prerequisite

Phase 0 belongs to the Hermes runtime and must ship `joblitRuntimeContractVersion: "1"`, execution-grant verification, account/profile attestation, scoped routes, strict tool policies, deterministic Skill attestation, idempotent runs, and non-persistent generation before Joblit sends personal data through the bridge.

## References

- [AI-Native Joblit Platform Design](../superpowers/specs/2026-07-15-ai-native-joblit-platform-design.md)
- [ADR-0001: Application AI provenance](0001-application-aicontent-provenance.md)
- [ADR-0002: Unified tailoring lifecycle](0002-unified-tailor-edit-flow.md)
- [ADR-0003: Browser-extension data path](0003-seek-fetch-via-browser-extension.md)
