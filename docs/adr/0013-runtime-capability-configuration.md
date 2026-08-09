# ADR-0013: Resolve optional runtime integrations as typed capabilities

- Status: Accepted
- Date: 2026-07-29

> **Partial supersession:** ADR-0017 retires the ATS-board capability together
> with GLOBAL intake. The capability resolver remains authoritative for every
> other optional integration described here.

## Context

Server modules previously read related environment variables independently.
That made one integration appear enabled in one code path and unavailable in
another, allowed half-configured credential pairs to fail late, and gave
boolean feature flags inconsistent parsing rules. Tests also had to mutate
global `process.env` to exercise configuration decisions.

This was most risky at execution seams: server Batch generation, artifact
reconciliation, FetchRun worker authentication and GitHub dispatch, ATS source
construction, Blob persistence, LaTeX rendering, and Gemini tailoring.

## Decision

`lib/server/runtimeCapabilities/index.ts` is the single interpretation seam for
those integrations.

- `resolveRuntimeCapabilities(environment)` is pure and accepts an injected
  environment for tests.
- `getRuntimeCapabilities()` is the production adapter over `process.env`.
- Each capability is a discriminated `enabled`, `disabled`, or `invalid`
  result where those states are meaningful.
- Consumers branch on the capability state and receive a complete typed config
  only from the `enabled` branch. They no longer assemble credential pairs or
  parse flags themselves.

The resolver owns cross-variable invariants:

- Artifact reconciliation requires both an explicit enable flag and at least
  one accepted bearer secret.
- GitHub FetchRun dispatch requires owner, repository, and token together;
  workflow and ref have stable defaults.
- `FETCH_RUN_SECRET`, LaTeX URL/token, ATS board JSON, Blob token, and Gemini
  key/model are interpreted in one place.
- Feature flags accept only their documented values. Unknown values never
  enable a capability.
- LaTeX requires HTTPS unless the dedicated insecure-HTTP flag is explicitly
  enabled; URLs containing credentials are rejected.

Secrets may appear only in the enabled configuration consumed by the adapter
that needs them. Capability reasons, thrown configuration errors, API
responses, and observability metadata contain stable reason codes rather than
secret values.

Missing or invalid required capability configuration fails closed. Optional
integrations remain explicitly disabled rather than being inferred from a
partial environment.

`lib/server/env.ts` remains the boot-time validation layer for required
deployment variables. Runtime capabilities are the finer-grained behavioral
contract used at request and service boundaries; they do not make a required
core variable optional.

## Consequences

- Half-configured integrations fail predictably instead of producing late,
  provider-specific errors.
- Tests can cover configuration matrices without mutating global process state.
- Adding a new consumer to an existing integration reuses one capability
  contract rather than duplicating environment parsing.
- Optional integrations have explicit safe defaults, while required secrets
  still fail closed.
- The resolver returns sensitive adapter configuration, so callers must never
  serialize or log the capability object. Only stable state and reason codes
  are suitable for diagnostics.
