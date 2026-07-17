# ADR-0004: Use the stock Hermes local API runtime for Joblit

- **Status:** Accepted
- **Date:** 2026-07-15
- **Context owner:** Joblit Engineering

## Context

Joblit needs a primary AI path that keeps users inside the product, can use each
user's own ChatGPT-connected local runtime, supports local career context, and
does not give a probabilistic agent control over authentication, scoring,
persistence, Finalize, or submission.

Joblit already owns user-scoped Jobs, Master Resume Profiles, `DRAFT`/`FINAL`
Applications, strict prompt and result contracts, AI provenance, PDF rendering,
extension authentication, and ATS autofill. The official Hermes API server can
provide local model execution through `/v1/runs`, status polling, cancellation,
profile isolation, and external-provider memory scoping. Its `openai-codex`
provider can use the user's ChatGPT subscription through Hermes-managed OAuth.
Hermes built-in memory is profile-wide and is not partitioned by request
headers.

The official Runs API does not expose deterministic per-request Skill preload,
Skill hashes, per-request tool policies, route-scoped tokens, or a
`persistSession: false` guarantee. Those unavailable controls must not become a
prerequisite that forces Joblit to fork or maintain Hermes.

## Decision

Use the official, unmodified Hermes release through a dedicated local profile:

- Joblit does not fork, patch, redistribute, or maintain Hermes source code.
- One dedicated Hermes profile per Joblit account (`joblit-<opaqueAccountHash>`)
  isolates Joblit configuration, API key, sessions, Skills, and local state.
  Each profile explicitly completes its own OAuth flow rather than relying on
  global credential fallback.
- A minimal Joblit profile distribution ships only `distribution.yaml`,
  `config.yaml`, `SOUL.md`, `.no-bundled-skills`,
  `joblit-package-manifest.json`, its detached signature, and Joblit-owned
  Skills. It contains no
  credentials, user records, sessions, or memories.
- The recommended model path is Hermes `openai-codex` with
  `model.openai_runtime: auto`, which keeps Hermes' standard
  `codex_responses` loop. Joblit does not enable the optional
  `codex_app_server` runtime because its Codex-native `shell` and `apply_patch`
  tools are always exposed independently of Hermes platform toolsets.
- The Chrome extension service worker is the only component that calls the
  loopback Hermes API. The Joblit page never receives the Hermes API key or the
  user's ChatGPT credentials.
- The page sends `jobId`, target, and a transient request ID through a typed
  content-script bridge. The extension obtains the authorized, versioned prompt
  from an extension-auth Joblit endpoint, calls official Hermes `/v1/runs`,
  polls `/v1/runs/{id}`, and can call `/v1/runs/{id}/stop`.
- The extension returns bounded model output and authoritative `promptMeta` to
  the authenticated page. The existing strict import endpoint rechecks
  ownership/freshness and persists only a `DRAFT`; no new Prisma `AiTask` table
  is required for the first release.
- Joblit sends the complete action-specific system prompt and strict output
  contract on every run. Correctness never depends on Hermes automatically
  loading an installed Skill or honoring a model-written claim that it did so.
- Joblit remains the deterministic system of record and policy engine. Hermes
  extracts requirements, matches evidence, drafts content, and explains
  uncertainty; Joblit validates schemas and evidence, calculates scores,
  checks ownership and revisions, persists results, and enforces state changes.
- New local-AI Application content always enters the existing
  `DRAFT` -> Edit -> Finalize lifecycle. AI cannot Finalize or submit.
- Joblit data remains the source of truth for career facts and confirmed
  preferences. The first-release generation profile disables built-in and
  external Hermes memory plus memory/session-search tools, then injects bounded
  confirmed preferences on every run. Honcho and other external memory
  providers are outside the first release.
- Manual Skill Pack, optional provider APIs, and Codex Batch remain migration
  fallbacks until they reach the same evidence and `DRAFT` behavior.

The detailed contracts, rollout, UX, and acceptance criteria live in
[AI-Native Joblit Platform Design](../superpowers/specs/2026-07-15-ai-native-joblit-platform-design.md).

## Alternatives considered

### Fork Hermes and add a Joblit-specific runtime contract

Joblit would add execution grants, route-scoped tokens, deterministic Skill
attestation, per-request tool policies, and non-persistent runs to Hermes.

**Rejected:** these controls are not required to deliver the product workflow,
would make Joblit responsible for a fast-moving third-party runtime, and would
create an unnecessary release and security-maintenance burden.

### Use the optional Codex app-server runtime

Hermes would delegate turns to a local Codex app-server process.

**Rejected for Joblit generation:** Codex-native shell and patch tools remain
available even when Hermes toolsets are empty. Joblit needs model inference,
not a coding-agent filesystem surface. The standard Hermes
`openai-codex`/`codex_responses` path still uses the user's ChatGPT subscription
while respecting Hermes platform toolset configuration.

### Hermes owns the workflow

Hermes would read and write Joblit data directly and decide persistence and
workflow transitions.

**Rejected:** this grants a probabilistic local agent excessive authority,
weakens auditability, and couples product logic to runtime internals.

### Cloud AI is the only path

**Rejected as the only path:** it cannot use each user's local ChatGPT-connected
runtime, moves credential and cost responsibility into Joblit, and loses the
intended local boundary. It remains a fallback option.

### Keep prompt and JSON copy/paste as the primary path

**Rejected:** it is operationally reliable but creates a fragmented,
high-friction experience. It remains the last-resort fallback.

## Consequences

### Positive

- No Hermes source fork, upstream worktree, custom release, or coordinated
  runtime patch is required.
- Users can use their own ChatGPT subscription without exposing credentials to
  Joblit.
- Existing extension, prompt, JSON import, Application, editor, and PDF paths
  remain reusable.
- Joblit retains deterministic authorization, scoring, validation, persistence,
  and Finalize behavior.
- The integration follows documented Hermes HTTP surfaces and can advance with
  official releases.

### Negative

- Hermes' API key protects a broad API surface; it is not a route-scoped token.
- A Hermes profile isolates runtime state but is not an operating-system
  sandbox.
- `/v1/runs` cannot prove that a particular Skill version was loaded.
- Hermes persists session/response state; Joblit cannot claim zero local
  retention. The product must expose accurate history-clearing controls.
- Official profile distribution updates are not a signed, immutable release
  channel. Joblit must pin a trusted release-artifact digest, verify its inner
  manifest, and revalidate active `config.yaml` after installation or update.
- A web page/ordinary extension cannot install profiles, write `.env`, inspect
  local config, or start Hermes. First release requires a user-launched Joblit
  Local Bootstrap and is labelled `Hermes Local AI Beta`; a later signed native
  host may automate that step.
- Local runtime discovery, authentication, upgrades, and recovery remain part
  of the product experience.

## Guardrails

- Require an official supported Hermes version and bind only to
  `127.0.0.1`/`localhost`. Reject public, LAN, or arbitrary remote endpoints.
- Use a separate high-entropy `API_SERVER_KEY`. Keep it only in extension
  `chrome.storage.local` after setting access to `TRUSTED_CONTEXTS`.
- Enable Hermes CORS only for the extension service worker's authenticated
  loopback JSON requests. Beta sideload builds use `*` because unpacked Chrome
  extension IDs vary; the random bearer key remains mandatory and is never
  exposed to page code. Replace `*` with the fixed Chrome Web Store extension
  origin once that public ID is assigned.
- Configure `platform_toolsets.api_server: [no_mcp]`, disable memory and all
  executable/API-generation toolsets, install no plugins, and keep
  `model.openai_runtime: auto`. A Joblit installer/verifier checks active local
  config after every update. `/v1/capabilities`, `/v1/models`, and
  `/v1/toolsets` verify only observable API compatibility/toolsets; stock HTTP
  cannot attest provider/runtime, default MCP inheritance, or Codex app-server
  built-ins.
- Declare exact `distribution_owned` paths, but independently enforce the same
  release-root/file-tree allowlist in Bootstrap and CI; do not trust upstream
  copy filtering as the only packaging boundary.
- Expose only typed `GET_STATUS`, `START_RUN`, `GET_RUN`, and `STOP_RUN`
  messages across the page-extension boundary. Validate origin, `event.source`,
  direction marker, request ID/nonce, action, entity ID, payload size, expiry,
  and rate. Never expose a generic local HTTP proxy or page-controlled Hermes
  request.
- Generate the complete prompt from Joblit's versioned contracts and treat Job
  descriptions, page content, and AI output as untrusted data.
- Validate output schema, evidence identifiers, byte limits, ownership,
  authoritative prompt metadata/hash, and available source revisions before
  persistence. Retry at most once with bounded validation feedback.
- Use body `session_id` only for transcript correlation. Do not claim
  `X-Hermes-Session-Key` partitions built-in memory; it only scopes configured
  external providers such as Honcho.
- Treat Hermes session history as user-controlled local data. Reduced-history
  mode may delete a tracked transcript through the Sessions API, but this does
  not clear Responses storage, profile/external memory, logs, run-status TTL
  records, or provider-side retention.
- Keep all telemetry content-free. Never log resume, Job, cover letter,
  application answers, prompts, model output, tokens, or memory text.
- AI output cannot directly mark an Application `FINAL` or submit a job-board
  form.

## Implementation prerequisite

The prerequisite is entirely Joblit-owned:

1. Publish the minimal Joblit Hermes profile distribution plus a Joblit-owned
   user-launched installer/verifier that validates a detached signature and
   path allowlist, provisions the account-specific profile/key/port, and
   rechecks active config. This is a Joblit bootstrap, not a Hermes Fork.
2. Add the extension loopback client, secure storage, capability/tool probes,
   and typed page bridge.
3. Add an extension-auth canonical-prompt endpoint, then reuse the existing
   prompt builder, strict JSON parser, and `DRAFT` editor for the first
   `TAILOR_RESUME` and `WRITE_COVER` vertical slices.
4. Add a typed match-assessment contract where Hermes returns evidence and
   Joblit calculates the final score.

No Hermes repository modification is a prerequisite.

## References

- [AI-Native Joblit Platform Design](../superpowers/specs/2026-07-15-ai-native-joblit-platform-design.md)
- [ADR-0001: Application AI provenance](0001-application-aicontent-provenance.md)
- [ADR-0002: Unified tailoring lifecycle](0002-unified-tailor-edit-flow.md)
- [ADR-0003: Browser-extension data path](0003-seek-fetch-via-browser-extension.md)
- [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)
- [Hermes Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles/)
- [Hermes Profile Distributions](https://hermes-agent.nousresearch.com/docs/user-guide/profile-distributions)
- [Hermes Codex Runtime](https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime)
