# Retire CN and GLOBAL job intake

- Status: Accepted
- Date: 2026-08-09

Joblit now treats Australian discovery as its only active Fetch Pipeline. The
Nowcoder-based CN adapter and all GLOBAL public-feed/ATS-board adapters are
retired because they created a large maintenance and correctness surface while
their product entry points were unavailable; CN Job data, Chinese Resume data,
Chinese LaTeX, and the Chinese UI remain supported.

Retirement is intentionally staged. The first release makes every Fetch write
and execution boundary AU-only, removes the adapters, and runs a bounded,
artifact-aware cleanup that deletes historical CN/GLOBAL FetchRuns and GLOBAL
Jobs without creating `DeletedJobUrl` tombstones. After old application
instances are drained and Blob retirement converges, a second release removes
the obsolete source-health and ATS-board database structures. This avoids an
expand/contract deployment race and keeps future AU re-imports possible.
