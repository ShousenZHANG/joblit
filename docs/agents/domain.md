# Domain Docs

Joblit uses a single-context domain documentation layout:

- `CONTEXT.md` contains canonical domain vocabulary.
- `docs/adr/` contains architectural decisions.

## Before exploring

Read `CONTEXT.md` and ADRs relevant to the area being changed. If either is
absent, proceed without creating placeholder documentation.

## Domain vocabulary

Use terms defined in `CONTEXT.md` for issue titles, hypotheses, tests, refactor
proposals, code, commits, and implementation notes.

If a required concept is missing or ambiguous, clarify it through
`domain-modeling` or `grill-with-docs` before introducing competing
terminology.

## ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict before
implementation. Do not silently override an architectural decision.
