# ADR-0012: Central Extension ingress and atomic abuse budgets

- **Status:** Accepted
- **Date:** 2026-07-29
- **Context owner:** Joblit Engineering

## Context

The Extension API had sixteen handlers with three incompatible preambles:

- most routes limited an IP before Bearer authentication but had no
  account-level budget;
- prompt and settings writes limited a user after authentication but allowed
  invalid tokens to drive unlimited token-store reads;
- settings reads had no budget.

The shared limiter was an isolate-local `Map`, so switching instances, IPs, or
tokens multiplied the effective allowance. Routes also differed on no-store
caching, request IDs, retry headers, and unexpected-error reporting. The token
creation response is especially sensitive because its raw token is shown once.

## Decision

Every `app/api/ext/**` handler enters through:

```ts
withExtensionRoute(request, operation, handler)
```

The exhaustive operation policy owns authentication mode and both limits.
Routes choose an operation; they cannot supply auth modes, numeric budgets,
cache flags, or reporting scopes.

Execution order is fixed:

1. create the transport request ID;
2. consume the operation's pre-auth IP budget;
3. authenticate with Session or Extension Bearer token;
4. consume the operation's post-auth user budget;
5. invoke the business handler;
6. map typed failures or report and redact unexpected failures;
7. add `Cache-Control: private, no-store, max-age=0`, `X-Request-ID`, and
   standard rate-limit headers to every response.

IP and user identifiers are HMAC fingerprints before they enter a budget key.
The user key intentionally excludes `tokenId` and IP, so creating another token
or changing networks does not create a new account allowance. Invalid
credentials consume only the pre-auth budget.

`AbuseBudgetPort.consume(debits)` is the internal seam. Production uses one
Upstash-compatible Redis REST `EVAL`: the script reads and validates every
debit, writes none when any would exceed its limit, and otherwise applies all
debits atomically. Tests and unconfigured local development use a deterministic
memory adapter. A distributed-store outage is reported and falls back to the
memory adapter; an incomplete URL/token pair is an invalid capability rather
than a silently half-enabled integration.

## Consequences

### Positive

- Invalid credentials cannot bypass the cheap pre-auth gate.
- A valid account shares one allowance across IPs, tokens, and serverless
  instances.
- Extension errors, request IDs, retry timing, caching, and observability have
  one wire contract.
- The raw-token response is explicitly non-cacheable.
- Adding a handler requires an explicit policy and is architecture-tested.

### Negative

- Reliable cross-instance enforcement requires a Redis REST capability.
- Shared NAT users share the wider IP allowance before authentication.
- Falling back during a store outage is weaker than distributed enforcement,
  but avoids turning a budget-store incident into an Extension outage.

### Follow-up

- Observe aggregate Extension IP/user traffic before enforcing cross-operation
  aggregate budgets.
- Weight bulk imports by item/byte cost after request-count telemetry exists.
- Let the Extension queue persist and obey `Retry-After` before lowering
  existing per-operation limits.

## Enforcement

`test/architecture/extensionIngress.test.ts` requires all eleven route files to
use the ingress, covers all sixteen operations exactly once, and forbids direct
auth, rate-limit, no-store, and reporting imports in those routes. Adapter and
ingress tests cover atomic N+1 consumption, all-or-nothing multi-debit
decisions, auth ordering, canonical responses, redaction, and outage fallback.
