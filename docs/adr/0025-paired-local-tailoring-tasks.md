# Pair a local assistant and retain one authorized tailoring task

- Status: Accepted
- Date: 2026-09-06
- Supersedes the browser integration and single-operator assumptions of ADR-0024.
- Preserves ADR-0015 (no server model credentials) and ADR-0023 (grounded tailoring).

Tailor now serves individual Joblit users through a Windows local assistant. A one-time installation registers a launch protocol; connecting is an explicit action and never starts generation. The user separately chooses a document and generates its PDF. Optional sign-in startup keeps the default installation on demand.

The assistant receives an authorized prompt and a capability for one task. It never receives database credentials or queries profiles itself. Model authentication remains inside Hermes. The website retains ownership checks, input-snapshot validation, deterministic content gates and PDF publication. The installed helper accepts only allowed origins, validates its loopback host and requires an origin/account-bound pairing token for control requests. URI activation only establishes a connection, never executes a supplied command or starts a model task.

## Recovery and cancellation

Closing a dialog or refreshing the browser detaches the observer. It does not cancel the task. The local assistant retains progress, calls the task's result endpoint and can finish a PDF without that dialog staying open. Server-side task and attempt receipts fence duplicate submissions and canceled or stale work against the same publication commit. They are not a batch queue or a worker that sweeps user jobs.

Explicit cancellation stops the child process and prevents further repair attempts. A publication already committed remains completed. A process interrupted by shutdown is reported as interrupted; it is not silently restarted and charged again. A sleeping or offline computer cannot continue model work.

## Direct PDF output

The user explicitly chose direct PDF output as the product default, followed by optional editing. This revises ADR-0024's single-operator-only recommendation for skipping human review. Deterministic checks establish content constraints, not prose quality; the completed document remains editable. Connecting and model authorization do not grant permission to generate unrelated documents.

## Delivery

The Windows package contains only the standalone assistant and setup scripts. Setup provisions a private, checksum-verified Node runtime and bootstraps a pinned Hermes installer only if Hermes is absent. Existing Hermes settings and credentials are preserved. The package is source-distributed and unsigned; no code-signing identity is implied. New task tables must be migrated before deploying the updated web application. Other operating systems retain the portable Node foundation but do not have an installation or launch integration in this release.
