# Security Policy

## Supported Versions

Joblit is in active development on the `master` branch. Security fixes are
released against the latest deployed version on `https://www.joblit.tech` and
the latest tagged Hermes profile package. Older builds are not supported.

## Reporting a Vulnerability

If you discover a security vulnerability, report it through
[GitHub's private security advisory form](https://github.com/ShousenZHANG/joblit/security/advisories/new)
or email the monitored role address `security@joblit.tech`.

Please include:

1. A clear description of the vulnerability and its impact.
2. Steps to reproduce, including any required preconditions.
3. The affected component (web app, API route, local Runner, Hermes bootstrap,
   or fetch worker).
4. Optional: a proof-of-concept, screenshots, or HAR capture.

**Do not open a public GitHub issue for security reports.**

## What to Expect

- Acknowledgement within **3 business days**.
- Initial assessment within **7 business days**.
- For confirmed vulnerabilities: a private fix branch, coordinated disclosure timeline, and credit in the resulting release notes (if you wish).

## Scope

In scope:

- The Joblit web application (`https://www.joblit.tech`)
- All API routes under `/api`
- The local Runner and signed Hermes profile/bootstrap release path
- The fetch-worker integration (GitHub Actions + JobSpy)

Runner access uses versioned, capability-scoped `AgentCredential` values. The
raw `jfagent_v1_` value is shown once and only its SHA-256 hash is stored by
Joblit; a presented Bearer credential never falls back to a browser session.
The machine-local Runner state file contains opaque run/session ids, hashes and
non-secret recovery metadata only — never prompts, model output, feedback text,
the AgentCredential, or the Hermes key.

Out of scope:

- Third-party services Joblit depends on (Vercel, Neon, GitHub, OAuth providers) — report to the respective vendors.
- Brute-force attacks, denial-of-service attacks, automated scanner output without manual validation.
- Reports that require physical access or social engineering.

## Sensitive Data

If you encounter user-identifiable data while researching, **stop and report**. Do not download, retain, or share it.

## Hall of Fame

We thank security researchers who responsibly disclose issues. With permission, we will acknowledge contributors in release notes.
