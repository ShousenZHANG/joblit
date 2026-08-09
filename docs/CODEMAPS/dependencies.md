# Dependencies and tooling

One npm project: the root Next.js app. Node `>=20.10`, npm `>=10`.

`tools/runner/` is dependency-free Node with no package of its own — see
ADR-0014 and `tools/runner/README.md`.

---

## Root — 40 dependencies

| Group | Packages |
|---|---|
| Framework | `next ^16.2.10`, `react 19.2.7`, `react-dom 19.2.7` (both pinned exactly) |
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

There is **no** AI SDK dependency. Gemini, OpenAI and Anthropic are called over
plain HTTP through `lib/server/net/safeFetch.ts` — see
[backend.md](./backend.md#outbound-network-edges).

### `overrides`

Seven packages are pinned in `package.json:114-122` — `hono`,
`@hono/node-server`, `lodash`, `postcss`, `fast-uri`, `uuid`, `ws`. None is a
declared dependency; all seven are transitive. They read as security floors.

`tools/ci/check-dependency-policy.mjs:19-20` reads only `pkg.dependencies` and
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

`npm run verify` → `tools/ci/verify.mjs`. Seven steps, in order:

1. `tsc --noEmit` (root)
2. `npm run lint`
3. `npm run deps:policy`
4. `npm run deadcode` — knip over files, dependencies, exports, types, duplicates
5. `npm run test` — root Vitest
6. `npm run test:runner` — Runner suites, Node's built-in test runner
7. `npm run hermes:package:test` — Hermes packaging and signatures

It prints a pass/fail summary and exits non-zero if any step failed.
`CONTRIBUTING.md` names this one command rather than a checklist, so the
contributor loop cannot drift from CI.

Deliberately **not** in `verify`, because they need credentials or network:
`next build` and `npm run deps:audit`. CI runs those on top.

### CI

`.github/workflows/ci.yml`, one `verify` job plus a `python-worker` job:
dependency policy → security policy → deployment-order policy → `npm audit
--omit=dev --audit-level=high` → knip → lint → `test:coverage` → Hermes
packaging tests → Runner tests → `next build`. The Python fetcher is tested
separately with pytest.

CI supplies dummy env values that satisfy module-load guards like
`prisma.ts`'s `DATABASE_URL` check. No service is contacted.

---

## Test runner

Vitest 4, jsdom, setup at `test/setup.ts`, path alias `@` → repo root.

`pool: "vmThreads"` — the default `forks` pool fails to register suites on
Windows in this project (`vitest.config.ts:56-58`).

Coverage thresholds are a **ratchet floor** set just under measured coverage,
not an aspirational gate: statements 57.7, branches 46.5, functions 54.1, lines
60.3 (`vitest.config.ts:41-46`). The comment there explains the reasoning — a
hard 80% today would be a false gate because much of `app/` UI is untested, so
locking the floor is the honest move and still blocks any drop.

Excluded from the root run: the `tools/` suites that use Node's built-in test
runner — `tools/hermes/**`, `tools/runner/**`, and `tools/deploy/`.

---

## External services

| Service | Required env | Used by |
|---|---|---|
| Neon Postgres runtime | `DATABASE_URL` (pooled) | running serverless application through `PrismaNeon` |
| Prisma migrations | `DIRECT_URL`, else `DATABASE_URL_UNPOOLED`, else `POSTGRES_URL_NON_POOLING`, else verified Neon host mapping | unpooled connection for `prisma migrate deploy`; production build rejects an unknown pooled fallback |
| NextAuth | `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET` | sign-in |
| LaTeX render service | `LATEX_RENDER_URL`, `LATEX_RENDER_TOKEN` | every PDF |
| Fetch worker config + commits | `FETCH_RUN_SECRET` | `/api/fetch-runs/[id]/{config,commit}` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | optional — absent, Tailoring falls back deterministically |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` | required for FINAL artifact persistence outside tests and for reconciliation; DRAFT does not upload |
| GitHub Actions | `GITHUB_OWNER/REPO/TOKEN/WORKFLOW_FILE` | optional — AU fetch dispatch |
| Cron | `CRON_SECRET` | Vercel's bearer credential for scheduled daily refresh and artifact reconciliation |
| Artifact reconcile | `ARTIFACT_RECONCILE_SECRET` | optional additional bearer for manual/operator calls; it does not replace `CRON_SECRET` for Vercel Cron |
| Artifact reconcile kill switch | `ARTIFACT_RECONCILE_ENABLED` | default off; only exact `true` / `1` enables inventory, claim, and delete |

`lib/server/env.ts:55` `validateServerEnv` owns baseline boot requirements.
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
