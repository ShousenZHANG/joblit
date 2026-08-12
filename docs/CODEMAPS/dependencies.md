# Dependencies and tooling

One npm project: the root Next.js app. Node `>=20.10`, npm `>=10`.

`tools/` holds no second package. The dependency-free Runner and Hermes trees
were deleted by ADR-0022; what remains under `tools/` is CI policy scripts, the
deploy helpers, the Python fetcher, and the README metrics script.

---

## Root — 40 dependencies

| Group | Packages |
|---|---|
| Framework | `next ^16.2.11`, `react 19.2.7`, `react-dom 19.2.7` (both pinned exactly) |
| Data | `@prisma/client ^7.8.0`, `@prisma/adapter-neon ^7.8.0`, `@neondatabase/serverless ^1.0.2` |
| Auth | `next-auth ^4.24.13`, `@next-auth/prisma-adapter ^1.0.7` |
| Validation | `zod ^4.3.5` — the canonical validation layer for every API boundary |
| i18n | `next-intl ^4.8.3` |
| State | `@tanstack/react-query ^5.90.19`, `@tanstack/react-virtual ^3.13.23` |
| UI primitives | 9 × `@radix-ui/react-*`, `cmdk`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `next-themes`, `nextjs-toploader` |
| Motion | `framer-motion ^12.26.2` |
| Drag and drop | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| PDF | `pdfjs-dist 5.4.296` (pinned exactly — the worker is self-hosted and must match), `react-pdf ^10.4.1` |
| Markdown | `react-markdown ^10.1.0`, `remark-gfm`, `rehype-highlight`, `highlight.js` |
| Storage | `@vercel/blob ^2.1.0` |
| Fonts | `geist ^1.7.0` |

**20 devDependencies**: `typescript ^5`, `eslint ^9` + `eslint-config-next`,
`vitest ^4.0.17` + `@vitest/coverage-v8`, `jsdom`, three `@testing-library/*`,
`axe-core` + `vitest-axe`, `tailwindcss ^4` + `@tailwindcss/postcss` +
`tw-animate-css`, `prisma`, `knip`, `dotenv`, and the `@types/*`.

There is **no** AI SDK dependency and **no provider module at all**. The server
calls no model (ADR-0015), and since ADR-0022 nothing in the repository drives
one either: generation happens wherever the user pastes the prompt.

### `overrides`

Nine packages are pinned in `package.json` `overrides` — `lodash`, `nanoid`,
`postcss`, `fast-uri`, `find-my-way`, `sharp`, `undici`, `uuid`, `ws`. None is a
declared dependency; all nine are transitive. They read as security floors.

`tools/ci/check-dependency-policy.mjs:18-19` reads only `pkg.dependencies` and
`pkg.devDependencies`, so it never inspects `overrides`. If the transitive path
that pulls one of these in changes, the pin silently stops applying and nothing
in the repo reports it. `npm audit --omit=dev` would catch a vulnerable resolved
version but not a dead pin.

---

## Dependency policy

`npm run deps:policy` → `tools/ci/check-dependency-policy.mjs`.

It enforces a **bidirectional** allowlist against `tools/ci/dependency-allowlist.json`:
every declared dependency must be listed, and every listed dependency must still
be declared — so a removed package leaves a failing stale entry rather than a
silently stale allowlist. It also enforces a `banned` set.

Adding any package therefore requires an allowlist edit in the same commit.

---

## Verification

`npm run verify` → `tools/ci/verify.mjs`. Five steps, in order
(`verify.mjs:23-27`):

1. `tsc --noEmit` (root)
2. `npm run lint`
3. `npm run deps:policy`
4. `npm run deadcode` — knip over files, dependencies, exports, types, duplicates
5. `npm run test` — root Vitest

The Runner and Hermes steps were removed with their code (ADR-0022), together
with the `test:runner` and `hermes:*` package scripts.

It prints a pass/fail summary and exits non-zero if any step failed.
`CONTRIBUTING.md` names this one command rather than a checklist, so the
contributor loop cannot drift from CI.

Deliberately **not** in `verify`, because they need credentials or network:
`next build` and `npm run deps:audit`. CI runs those on top.

### CI

`.github/workflows/ci.yml`, one `verify` job plus a `python-worker` job:
dependency policy → security policy → deployment-order policy → full migration
replay against a Postgres service plus `prisma migrate diff --exit-code` → the
post-retirement inventory fence → the expand/contract drift replay → `npm audit
--omit=dev --audit-level=high` → knip → lint → `test:coverage` → `next build`.
The Python fetcher is tested separately with pytest.

**Known stale steps.** The `verify` job still runs
`npm run hermes:package:test` and `npm run test:runner` after
`test:coverage`. Neither script exists in `package.json` any more, so both
steps fail. `test/ciWorkflow.test.ts` does not pin them, so nothing in the root
suite catches it.

Other workflows: `dependency-policy.yml`, `hermes-profile.yml` (also orphaned
by ADR-0022), `jobspy-fetch.yml`, `lighthouse.yml`.

CI supplies dummy env values that satisfy module-load guards like
`prisma.ts`'s `DATABASE_URL` check. No external service is contacted.

---

## Test runner

Vitest 4, jsdom, setup at `test/setup.ts`, path alias `@` → repo root.

`pool: "vmThreads"` with `maxWorkers: 4` — the default `forks` pool fails to
register suites on Windows in this project (`vitest.config.ts:48-54`).

Coverage thresholds are a **ratchet floor** set just under measured coverage,
not an aspirational gate: statements 76.5, branches 66.5, functions 75, lines
79 (`vitest.config.ts:42-46`). The comment there explains the reasoning — a
hard 80% today would be a false gate because much of `app/` UI is untested, so
locking the floor is the honest move and still blocks any drop.

Excluded from the root run (`vitest.config.ts:55-66`):
`tools/deploy/vercel-build.test.mjs`, which uses Node's built-in test runner.
The `tools/hermes/**` and `tools/runner/**` exclusions are left over from
ADR-0022 and now match nothing. `tools/ci/server-fetch-policy.test.mjs` and
`tools/deploy/migrationUrl.test.ts` are **not** excluded and do run under
Vitest.

---

## External services

| Service | Required env | Used by |
|---|---|---|
| Neon Postgres runtime | `DATABASE_URL` (pooled) | running serverless application through `PrismaNeon` |
| Prisma migrations | `DIRECT_URL`, else `DATABASE_URL_UNPOOLED`, else `POSTGRES_URL_NON_POOLING`, else verified Neon host mapping | unpooled connection for `prisma migrate deploy`; production build rejects an unknown pooled fallback |
| NextAuth | `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET` | sign-in |
| LaTeX render service | `LATEX_RENDER_URL`, `LATEX_RENDER_TOKEN` | every PDF |
| Fetch worker config + commits | `FETCH_RUN_SECRET` | `/api/fetch-runs/[id]/{config,commit}` |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` | required for FINAL artifact persistence outside tests and for reconciliation; DRAFT does not upload |
| GitHub Actions | `GITHUB_OWNER/REPO/TOKEN/WORKFLOW_FILE` | optional — AU fetch dispatch |
| Cron | `CRON_SECRET` | Vercel's bearer credential for the one scheduled job — `/api/artifacts/reconcile`, daily at 07:00 UTC (`vercel.json`) |
| Artifact reconcile | `ARTIFACT_RECONCILE_SECRET` | optional additional bearer for manual/operator calls; it does not replace `CRON_SECRET` for Vercel Cron |
| Artifact reconcile kill switch | `ARTIFACT_RECONCILE_ENABLED` | default off; only exact `true` / `1` enables inventory, claim, and delete |

`lib/server/env.ts:56` `validateServerEnv` owns baseline boot requirements.
`BLOB_READ_WRITE_TOKEN` is enforced at the FINAL/reconciler boundary
instead of global boot because DRAFT edits do not touch Blob storage.

`prisma.config.ts` resolves the migration endpoint through
`tools/deploy/migrationUrl.mjs`. Neon/Vercel database integrations normally
inject one of the unpooled names; manually wired deployments set `DIRECT_URL`.
When only a standard `*.neon.tech` `-pooler` hostname exists, the resolver
derives the documented direct hostname while preserving credentials and TLS
parameters. It never guesses for another provider. Keep `DATABASE_URL` pooled
for the app. Prisma migrate uses a session-scoped advisory lock, which a
transaction pooler cannot retain across statements, so
`tools/deploy/vercel-build.mjs` refuses any still-pooled production
configuration before the migration starts.

`IMPORT_SECRET` and the split `/api/admin/import` +
`/api/fetch-runs/[id]/update` callback flow were retired by ADR-0008. The AU
worker now authenticates configuration reads and `fetch-run-commit/v1`
commands with the one `FETCH_RUN_SECRET`. CN Fetch and GLOBAL feed/ATS execution
were retired by ADR-0017; non-AU execution fails closed.

`LATEX_RENDER_ALLOW_INSECURE_HTTP=true` relaxes transport encryption only. The
render token travels as a request header, so on plain HTTP it crosses the
network in the clear. Set it only for a self-hosted renderer with no TLS yet,
and treat putting TLS in front of that renderer as the actual fix. Every other
outbound protection stays enforced.
