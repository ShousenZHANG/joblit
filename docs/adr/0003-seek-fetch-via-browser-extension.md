# ADR-0003: Retire server-side Seek fetching in favour of a browser-extension path

- **Status:** Accepted
- **Date:** 2026-06-14
- **Context owner:** Eddy Zhang

## Context

Seek (au.seek.com) sits entirely behind Cloudflare. The server-side fetcher
(`tools/fetcher/run_seek.py`) runs on GitHub Actions — a **datacenter IP range**.
Across multiple live runs we confirmed, with logs, that Seek is unreachable from
that environment:

- The legacy v5 REST path warms up `au.seek.com/jobs` (an **HTML page**) before
  hitting `/api/jobsearch/v5/search`. Cloudflare JS-challenges that HTML warm-up
  on **every** attempt from a datacenter IP, even with polite retries
  (`warm-up 3/3 challenge`). `siteKey` was also stale (`AU-Main`, now `AU`).
- Switching to Seek's **current** stack — the consumer graphql BFF
  `POST /graphql`, operation `JobSearchV6` (a JSON API POST, **not** the HTML
  page; the same endpoint the on-demand JD fetch uses) — still returns **403**
  from the same IP (`status=403`, no warm-up, ~0.8s).

Cloudflare gates on **IP reputation** (datacenter vs residential) and
**TLS/JA3 fingerprint**, not only cookies. A cookieless, non-browser client from
a datacenter IP is blocked at *every* Seek endpoint. We will **not** solve the
challenge, spoof TLS/JA3 fingerprints, or rotate residential proxies — those
circumvent an access-control measure and breach Seek's Terms of Use
(au.seek.com/terms, clauses 7(d), 9(b), 9(d)).

A live browser capture confirmed the identical `JobSearchV6` request **succeeds**
from a logged-in user's own browser (residential IP + real fingerprint + session
cookie; `software engineer` → 1784 results).

## Decision

Server-side Seek fetching is **retired**. It stays behind the
`SEEK_FETCH_ENABLED` kill-switch, **off by default**:

- Flag off → the Fetch page shows **LinkedIn only** (the source toggle and the
  Seek classification / work-type filters are gated on the flag in
  `app/(app)/fetch/FetchClient.tsx`), the page description drops Seek, and the
  worker refuses to run (`SeekFetcher._ensure_enabled`).
- The Seek worker code is **kept, not deleted** — the `JobSearchV6` graphql
  query, `map_job` (shape-compatible with the BFF payload), the relevance /
  exclusion filters, `import_items` (dedupe + `DeletedJobUrl` tombstones), and
  the on-demand JD enrich (`lib/server/seek/fetchJobDescription.ts`) are all
  reused by the planned extension path.

The path forward is a **Chrome-extension fetch**: the user's own logged-in
browser issues the `JobSearchV6` request (residential IP + real fingerprint +
their Seek session) and POSTs the mapped rows to a new `/api/ext/jobs/import`.
This is the most ToS-defensible option — the user accesses content they are
authorised to see, no access control is circumvented, and **Seek credentials
never leave the user's browser** (Joblit never sees a password or cookie). See
ADR follow-up when the extension path ships.

## Consequences

- Seek is unavailable as a *server-side* source until the extension path ships;
  **LinkedIn (JobSpy) remains the server-side source** and is unaffected.
- A challenge-blocked run reports a **FAILED** `FetchRun` with a `seek_challenge`
  marker (the UI surfaces "rate-limited / try later") and the worker **exits 0**
  — an upstream IP block is an expected external condition, not a worker fault,
  so it must not red CI on every manual dispatch. Genuine worker faults still
  exit 1.
- Re-enabling server-side Seek is a single env flag, but is **expected to keep
  failing from datacenter IPs**; the flag exists for local / residential
  operators and for tests.
- The extension path is independent of `SEEK_FETCH_ENABLED` — it imports through
  `/api/ext/*` with an extension token, so retiring the server-side path does
  not block it.
