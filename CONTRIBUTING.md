# Contributing to Joblit

Thanks for considering a contribution. This document covers the development workflow, commit conventions, and review expectations.

## Development Setup

1. Fork and clone the repository.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and fill in credentials (see [README — Environment Variables](./README.md#environment-variables)).
4. Run database migrations: `npx prisma migrate deploy`.
5. Start the dev server: `npm run dev`.
6. Run tests: `npm test`.

## Branching

- Default branch: `master`.
- Feature branches: `feat/<short-slug>`, fixes: `fix/<short-slug>`.
- Keep PRs small and focused (~100–300 changed lines is ideal).

## Commit Conventions

Conventional commits, lowercase type:

```
<type>(<scope>): <short description>

<optional body, wrap at 72 cols>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `polish`, `ci`.

Examples:
- `feat(jobs): add bulk-status update`
- `fix(extension): debounce form-fill events on Workday`
- `refactor(market): consolidate locale conversions into single seam`

## Pull Request Checklist

Before requesting review:

- [ ] `npm run lint` passes (0 warnings)
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` passes for files you touched
- [ ] New behaviour has tests (target 80%+ coverage on new code)
- [ ] No secrets committed (check `git diff`)
- [ ] If you added an env var, update `.env.example` and the README table
- [ ] If you changed an architectural decision, add an ADR under `docs/adr/`

## Code Style

- TypeScript strict mode. Avoid `any`; use `unknown` and narrow.
- Prefer explicit types on exported functions; let TS infer locals.
- Immutable updates — spread, don't mutate.
- Files <800 lines, functions <50 lines, max 4 levels of nesting.
- Validate all external input with Zod schemas at the boundary.
- No `console.log` in production code; route through `lib/server/observability/errorReporter.ts` on the server.

## Tests

- Unit tests live alongside source as `*.test.ts` / `*.test.tsx`.
- API route tests in `test/api/`, server-module tests in `test/server/`.
- Run a single file: `npx vitest run path/to/file.test.ts`.
- Prefer testing through the public interface; avoid mocking implementation internals.

## Architecture Decisions

When a change implies a decision that should outlive the PR thread, add a short ADR under `docs/adr/`. Format: see existing ADRs or [Michael Nygard's template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard).

## Reporting Bugs

Open a GitHub issue with:

- A clear title that names the symptom
- Steps to reproduce
- Expected vs actual behaviour
- Environment (Node version, OS, browser if relevant)
- A minimal repro if possible

For security vulnerabilities, see [SECURITY.md](./SECURITY.md) — do **not** file a public issue.

## Code of Conduct

This project follows a simple principle: **be kind, be specific, be respectful.** Disagree with code, never with people. Substantive technical critique is welcome; ad-hominem comments are not.

## License

By contributing, you agree that your contributions will be licensed under the project's [Apache License 2.0](./LICENSE).
