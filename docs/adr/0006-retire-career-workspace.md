# ADR-0006: Retire the standalone Career workspace

- Status: Accepted
- Date: 2026-07-20

## Context

Joblit's primary workflow is job discovery, fit triage, CV/CL generation, and
application execution. The standalone Career workspace duplicated that flow
with a second product surface for analytics, reminders, interview plans, STAR
stories, and offers. It added a top-level navigation choice and a large public
API surface without strengthening the primary workflow.

## Decision

- Remove Career from desktop and mobile navigation.
- Remove the standalone Career client, translations, and Career-only APIs.
- Keep `/career` as a compatibility redirect to `/jobs` for existing bookmarks.
- Keep application status events and CV/CL evidence provenance. Jobs,
  extensions, and generated-document review depend on those records.
- Retain existing interview, STAR-story, offer, and reminder database tables
  without active writers. Dropping stored user data requires a separate,
  explicitly approved retention migration.
- Future interview or offer capabilities must live inside the relevant Jobs or
  Resume workflow instead of restoring another top-level workspace.

## Consequences

- Navigation and product scope become smaller and clearer.
- Nine unused authenticated API routes and their supporting services disappear.
- Existing application history and evidence integrity remain intact.
- Existing Career-only records remain preserved but inaccessible until a
  separate data-retention decision is made.
