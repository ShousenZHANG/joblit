# Open Free Self-Service Access Design

**Date:** 2026-07-13
**Status:** Approved for implementation
**Decision:** Replace invite approval with open Google/GitHub self-service sign-in while retaining authentication and per-user data isolation.

## Context

Joblit currently accepts Google and GitHub OAuth credentials but applies a second, product-specific invitation gate. Unapproved users are redirected into an access-request flow, while approved administrators manage requests through a dedicated console. That gate now conflicts with the product direction: Joblit should be free and immediately available to every person who can complete a supported OAuth sign-in.

The invitation system spans authentication callbacks, session typing, administration UI and APIs, a public request form, translations, tests, documentation, and the `AccessRequest` database model. Removing only the visible form would leave an active authorization gate and dead operational code. Conversely, removing authentication itself would expose private resumes, jobs, applications, fetch runs, and extension tokens across users.

## Goals

- Let any valid Google or GitHub OAuth user create an account and start immediately.
- Remove invitation requests, manual approval, invite administrators, and their database storage.
- Present a polished, low-friction, bilingual free-access experience across Landing and Login.
- Preserve session authentication, ownership checks, internal service secrets, rate limits, and abuse controls.
- Remove all resulting dead code, obsolete copy, configuration, tests, and documentation.
- Leave the repository and database migration history safe for both existing and fresh deployments.

## Non-goals

- Anonymous access to private application data.
- Removal of OAuth, NextAuth sessions, or `userId` ownership filters.
- Removal of internal worker endpoints or secrets such as `IMPORT_SECRET`, `FETCH_RUN_SECRET`, and `CRON_SECRET`.
- A billing implementation. The current product is presented as free; this change does not add subscriptions or payment infrastructure.
- Renaming the unrelated secret-protected `/api/admin/import` worker endpoint.

## Authentication and Authorization

The NextAuth `signIn` invitation callback will be removed. Provider authentication will therefore use the standard adapter behavior: a successful Google or GitHub sign-in may create or reuse a `User` record without consulting an allowlist or access-request table.

The session callback will continue to copy the database user ID into `session.user.id`. The invitation-only `isAdmin` field and administrator-email lookup will be removed from both the callback and TypeScript augmentation.

All application pages and APIs that currently require a session will remain protected. Every Prisma query that scopes records by `userId` will remain in place. This creates an open-registration product, not an anonymous or shared-data product.

Ordinary OAuth failures will continue to return to `/login`. The login page will replace the invite-denial branch with accessible, recoverable error messages for account-linking, provider cancellation/denial, and unknown authentication failures.

## Removed Invitation System

The implementation will delete:

- the public access-request API and landing email request form;
- the access-request service and admin-email authorization helper;
- the admin access-request list/update APIs;
- the Admin Access page and navigation entry;
- invitation-specific session fields, translations, tests, environment documentation, and README sections.

The secret-protected JobSpy import route at `/api/admin/import` is not part of the invitation system and will remain unchanged.

## Database Change

`AccessRequestStatus` and `AccessRequest` will be removed from `prisma/schema.prisma`.

A new forward migration will drop the obsolete table first and then its PostgreSQL enum:

```sql
DROP TABLE IF EXISTS "AccessRequest";
DROP TYPE IF EXISTS "AccessRequestStatus";
```

The existing migration that originally created these objects will not be edited or deleted. Existing databases can apply the new migration safely, and fresh databases can replay the full immutable history to the same final schema. Existing access-request email records are intentionally discarded because the approval workflow is being retired.

## Landing and Login Experience

The landing-page hierarchy will become:

1. Hero stating that Joblit is free and open to everyone.
2. Existing product evidence, features, workflow, and trust content.
3. FAQ explicitly resolving invitation, approval, subscription, and credit-card concerns.
4. Final CTA that routes directly to `/login`.

The obsolete `#access` form section and navigation target will be removed rather than cosmetically restyled. Hero, navigation, and final CTA buttons will link directly to `/login` for unauthenticated visitors and `/jobs` for authenticated users. Loading state will use the safe `/login` destination instead of a dead anchor.

English and Chinese copy will consistently communicate:

- free access for everyone;
- no invitation or manual approval;
- no credit card;
- automatic account creation after Google or GitHub sign-in;
- private, account-scoped workspace data.

The copy will avoid the legally inflexible promise “free forever”.

The login page will retain both OAuth provider buttons, loading feedback, callback URL handling, terms/privacy links, keyboard access, visible focus states, and a `role="alert"` error region. It will no longer offer a request-access detour.

## Security and Cost Controls

Open registration increases the potential volume of Gemini, JobSpy, PDF, storage, and other resource-consuming operations. Existing per-user/global rate limits, ownership checks, and worker secrets will therefore remain. No client-facing code may receive server secrets.

GitHub accounts with private email settings must be exercised during authentication verification because some email-dependent Fetch operations use stricter session requirements. A provider limitation must produce a clear user-facing error rather than weaken authorization.

## Testing and Verification

The change will update or add coverage for:

- auth configuration without an invitation `signIn` callback;
- session user ID preservation and removal of `isAdmin`;
- Landing composition after removal of the access form;
- direct `/login` CTA behavior in loading and unauthenticated states;
- Login OAuth error recovery and accessible alerts;
- English and Chinese messages with no invitation/approval residue;
- retained unauthenticated redirects and API 401 behavior;
- retained cross-user data ownership protections;
- Prisma schema validation, generated client, and migration SQL;
- dead-code, lint, type-check, unit/integration, build, and repository-hygiene checks.

A repository-wide search will confirm that obsolete invitation APIs, routes, translations, Admin Access symbols, `ADMIN_EMAILS`, and `#access` references are gone. References to the unrelated internal import route and historical immutable migrations are expected and must not be removed.

## Deployment

Application code can be deployed with the new forward Prisma migration. Since the new application no longer queries `AccessRequest`, either code-first or migration-first rollout does not introduce a runtime dependency on the dropped table. Production should remove any obsolete `ADMIN_EMAILS` environment setting after deployment.

## Acceptance Criteria

- A previously unseen Google or GitHub user can sign in without manual approval and reach `/jobs`.
- Landing and Login contain no invitation form, approval queue, Invite-only text, or Admin Access navigation.
- The access-request public/admin APIs and services no longer exist.
- `AccessRequest` and `AccessRequestStatus` are absent after `prisma migrate deploy`.
- Unauthenticated users still cannot access private application pages or protected APIs.
- One user cannot read or modify another user's jobs, resumes, applications, batches, fetch runs, or extension tokens.
- Secret-protected import and scheduled worker flows remain functional.
- English and Chinese UI communicate free, immediate self-service access consistently.
- Required CI checks pass and the final repository contains no newly introduced generated artifacts or personal data.
