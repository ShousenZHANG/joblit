# Joblit outbound and extension release security

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

Current protected integrations include global job feeds, SEEK JD enrichment,
GitHub Actions dispatch, GitHub Trending, YouTube Data API, AI providers, the
LaTeX render service, and trusted resume photos. The Python JobSpy detail
enricher applies equivalent HTTPS, DNS-preflight, redirect, and body limits.

## Untrusted content

`lib/server/security/untrustedOutput.ts` provides:

- `sanitizeMarkdown` for user or provider Markdown.
- `escapeTsvCell` for formula-safe single-line TSV cells.
- `sanitizePipelineUrl` for HTTPS-only persistence, logs, and exports.

LLM prompts must place candidate and JD data inside explicitly untrusted,
JSON-encoded evidence blocks. Raw JD or candidate text must not be appended
after the guarded blocks.

## Chrome extension permissions

`tools/ci/security-policy.json` is the reviewed permission allowlist.
`tools/ci/check-security-policy.mjs` fails CI if required permissions, optional
host capabilities, content-script matches, or CSP drift. It also rejects
tracked secrets, local home paths, release archives, local environment files,
and symlinks.

The broad HTTPS optional host pattern does not grant access at installation.
The extension requests only the exact validated origin at runtime. Required
host access remains limited to `https://www.joblit.tech/*`.

## Extension release integrity

`tools/ci/package-extension.mjs` walks the built tree with `lstat`, rejects
symlinks and special files, enforces size limits and case-unique paths, and
generates a sorted per-file SHA-256 manifest plus a tree digest.

The release workflow:

1. Builds and tests the extension.
2. Verifies tag version equals built manifest version.
3. Generates the reviewed file list and integrity manifest.
4. Archives exactly that sorted list with metadata stripped.
5. Publishes the ZIP, ZIP SHA-256, and file-tree manifest together.

All product fetches are explicitly user initiated; no scheduler is installed.
