# Joblit outbound and local-runtime release security

## Server outbound requests

Server code that contacts a URL must use
`lib/server/net/safeFetch.ts`. Direct `fetch()` is allowed only for relative
same-origin browser requests.

The gateway enforces:

- HTTPS by default.
- Optional exact-host or dot-anchored subdomain allowlists.
- DNS validation before the first request and every redirect hop.
- Rejection when any DNS answer is loopback, RFC1918, link-local, cloud
  metadata, CGNAT, IPv6 ULA, multicast, documentation, or otherwise reserved.
- Manual redirects, a strict redirect limit, and removal of credentials on
  cross-origin redirects.
- Total request timeout and bounded response body.
- Error messages that never contain query strings or API keys.

### DNS validation boundary

DNS validation is a preflight control, not IP pinning. The platform `fetch`
implementation may resolve the hostname again when it opens the connection.
An answer could therefore change between validation and connect, leaving a
residual TOCTOU / DNS-rebinding window.

Risk is reduced by exact, fixed host allowlists for first-party integrations,
rechecking every redirect destination, rejecting a hostname when any preflight
answer is non-public, and applying strict redirect, timeout, and body limits.
These controls must not be described as complete fail-closed protection
against DNS rebinding. Eliminating the residual window requires a verified-IP
connection mechanism or controlled egress proxy that preserves TLS hostname
verification.

Current protected integrations include global job feeds, GitHub Actions
dispatch, GitHub Trending, YouTube Data API, AI providers, the LaTeX render
service, and trusted resume photos. The Python JobSpy detail enricher applies
equivalent HTTPS, DNS-preflight, redirect, and body limits.

## Untrusted content

`lib/server/security/untrustedOutput.ts` provides:

- `sanitizeMarkdown` for user or provider Markdown.
- `escapeTsvCell` for formula-safe single-line TSV cells.
- `sanitizePipelineUrl` for HTTPS-only persistence, logs, and exports.

LLM prompts must place candidate and JD data inside explicitly untrusted,
JSON-encoded evidence blocks. Raw JD or candidate text must not be appended
after the guarded blocks.

## Repository security policy

`tools/ci/security-policy.json` and
`tools/ci/check-security-policy.mjs` reject tracked secrets, local home paths,
release archives, local environment files, and symlinks. They also enforce that
server-side network calls use the reviewed `safeFetch` seam instead of direct
platform `fetch`. Exact raw `jfagent_v1_` credentials (and retired `jfext_`
credentials) are treated as secrets, while retired extension source paths are
forbidden from re-entering the active repository.

## Hermes profile release integrity

The Hermes profile workflow validates the minimal profile source, runs package
and Windows bootstrap tests, builds twice and compares the exact staged trees,
and rejects runtime state, links, or credential material. Production release
requires a reviewed Ed25519 key, verifies the signed manifest before archiving,
strips archive metadata, publishes a SHA-256 checksum, and refuses to replace
an existing release asset.

The bootstrap accepts only a verified package, installs it into an isolated
profile, writes its loopback secret with a current-user ACL, and binds the
Hermes gateway to `127.0.0.1`. The Node Runner does not require browser CORS;
the bootstrap removes the retired wildcard setting and readiness checks reject
profiles that still contain it.

All product fetches are explicitly user initiated; no scheduler is installed.
