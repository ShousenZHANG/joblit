# Issue tracker: GitHub

Issues and PRDs for this repo live in GitHub Issues for
`ShousenZHANG/joblit`. Use the `gh` CLI for issue operations.

## Conventions

- Create issues with `gh issue create`.
- Read complete issue bodies, comments, and labels before acting.
- List issues with appropriate state and label filters.
- Apply labels using `docs/agents/triage-labels.md`.
- Do not close or modify parent issues when creating implementation slice issues.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub Issues remain the canonical request and triage surface.

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue in
`ShousenZHANG/joblit`.

When a skill says "fetch the relevant ticket", read the issue body, labels,
and comments with `gh issue view <number> --comments`.

## Wayfinding operations

- A wayfinding map is one issue labelled `wayfinder:map`.
- Child tickets use `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- Prefer GitHub sub-issues and native blocking dependencies.
- Fall back to task lists and `Blocked by: #<number>` when native dependencies
  are unavailable.
- Claim work by assigning the issue before implementation.
- Resolve work by recording the answer, closing the child issue, and updating
  the map.
