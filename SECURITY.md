# Security Policy

## Supported Versions

Joblit is in active development on the `master` branch. Security fixes are released against the latest deployed version on `https://www.joblit.tech` and the latest tagged Chrome extension build. Older builds are not supported.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

- **Email:** `eddy.zhang24@gmail.com`
- **Subject prefix:** `[SECURITY]`

Please include:

1. A clear description of the vulnerability and its impact.
2. Steps to reproduce, including any required preconditions.
3. The affected component (web app, API route, Chrome extension, fetch worker).
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
- The Chrome extension distributed via the Chrome Web Store or the public release `.zip`
- The fetch-worker integration (GitHub Actions + JobSpy)

Out of scope:

- Third-party services Joblit depends on (Vercel, Neon, GitHub, OAuth providers) — report to the respective vendors.
- Brute-force attacks, denial-of-service attacks, automated scanner output without manual validation.
- Reports that require physical access or social engineering.

## Sensitive Data

If you encounter user-identifiable data while researching, **stop and report**. Do not download, retain, or share it.

## Hall of Fame

We thank security researchers who responsibly disclose issues. With permission, we will acknowledge contributors in release notes.
