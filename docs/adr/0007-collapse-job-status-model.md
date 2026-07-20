# ADR-0007: Collapse the job status model to three states

- Status: Accepted
- Date: 2026-07-20

## Context

`Job.status` carried seven states: NEW, APPLIED, INTERVIEW, OFFER, REJECTED,
WITHDRAWN, ACCEPTED. Joblit's workflow is discovery, fit triage, CV/CL
generation and application. It produces exactly three of those states and does
nothing with the other four — no interview preparation, no offer comparison, no
negotiation support. Tracking them is pipeline management, the same surface
ADR-0006 retired with the Career workspace.

The cost was concentrated in the Jobs toolbar, where seven status filters sat
in a horizontally scrolling row alongside four fit controls, all rendered as
identical pills.

## Decision

- Offer three statuses: NEW, APPLIED, REJECTED.
- Keep all seven values in the Prisma enum and in `JOB_STATUS_VALUES`.
  `ApplicationEvent` records historic transitions verbatim and must stay
  readable; dropping an enum value would rewrite that history.
- Add `ACTIVE_JOB_STATUS_VALUES` as the set the product offers, and restrict
  transitions and status writes to it.
- Migrate existing rows: INTERVIEW, OFFER and ACCEPTED become APPLIED;
  WITHDRAWN becomes REJECTED.
- Read any stored status through `toActiveJobStatus`, so a row the migration
  missed still resolves to a reachable state instead of disappearing from a
  board that can no longer filter for it.

## Consequences

- No information is lost. `Job.status` is a read-optimized projection;
  `ApplicationEvent` remains the source of truth, so a job that reached
  INTERVIEW still has that transition recorded.
- The status filter fits without scrolling, which is what made a segmented
  control viable.
- A URL bookmarked under a retired status resolves to the state that status now
  reads as rather than silently resetting.
- Interview, offer and acceptance tracking cannot be re-added as statuses
  without a new decision. Per ADR-0006 that capability belongs inside the Jobs
  or Resume workflow, not as more projection states.
