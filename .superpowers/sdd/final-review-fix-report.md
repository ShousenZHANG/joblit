# Final Review Fix Report

## Status

DONE

The required focused tests, scoped lint, TypeScript check, Prisma validation, and
diff checks all passed. The full suite and production build were intentionally not
run in this fix wave, as required by the brief.

## RED Evidence

Command:

```text
npx vitest run lib/server/fetchRuns/fetchRunQuota.test.ts test/api/fetchRunsCreate.test.ts test/api/fetchRunsTrigger.test.ts "app/(app)/fetch/FetchClient.test.tsx" components/landing/lib/useCtaHref.test.tsx
```

Observed before production changes:

- 5 test files failed; 7 tests failed and 21 passed.
- The quota suite could not resolve the not-yet-created `fetchRunQuota` module.
- Create returned `201` instead of the expected structured `429`.
- Trigger continued to the dispatch path instead of stopping before claim/dispatch.
- FetchClient rendered `RAW_SERVER_CAPACITY_MESSAGE` for create and `[object Object]`
  for trigger instead of translated recovery copy.
- `useCtaHref` returned no label for any session state.

## GREEN Evidence

- Focused Vitest command above: 5 files passed, 36 tests passed.
- Scoped ESLint over all changed TypeScript/TSX files: exit 0.
- `npx tsc --noEmit`: exit 0.
- `npx prisma validate`: schema valid, exit 0.
- `git diff --check` and staged diff check: exit 0.
- `messages/en.json` and `messages/zh.json`: parsed successfully as JSON.
- Diff audit confirmed no changes under `prisma/schema.prisma` or
  `prisma/migrations/`.

## Persistent Limits

```ts
{
  userActive: 2,
  globalActive: 20,
  userHourly: 6,
  globalHourly: 120,
  windowSeconds: 3600,
}
```

Active statuses are `QUEUED` and `RUNNING`. Create rejects equality because its
new row is not counted yet; trigger rejects only a count over the limit because
the current queued row is already in every count. Active violations return a
30-second `Retry-After`; hourly violations return 3600 seconds.

## Atomicity and Lock Order

`FetchRun` remains the only quota ledger; no quota table or schema change was added.
The shared quota helper takes a fixed PostgreSQL two-integer transaction advisory
lock, then reads user active, global active, user hourly, and global hourly counts.
Create checks and inserts inside the same Prisma transaction, so the global lock
serializes count-plus-create across users and serverless isolates.

Trigger retains its existing single-bigint per-run try-lock and performs ownership,
state, replay, and already-dispatched checks first. Its order is then global quota
transaction lock, four counts, and finally the `inFlightAt` claim. The two-integer
quota lock namespace cannot collide with the single-bigint per-run lock namespace,
and no code path acquires these locks in reverse order.

## Deployment Sequence

Existing environments must use this code-first drain runbook:

1. Deploy the current code without running the destructive drop migration.
2. Wait for all old instances and serverless deployment versions to drain.
3. Run `npx prisma migrate deploy`.
4. Remove `ADMIN_EMAILS`.

Fresh environments may run migrations during initial provisioning. No historical
migration SQL was changed.

## Files

- `lib/server/fetchRuns/fetchRunQuota.ts`
- `lib/server/fetchRuns/fetchRunQuota.test.ts`
- `app/api/fetch-runs/route.ts`
- `app/api/fetch-runs/[id]/trigger/route.ts`
- `test/api/fetchRunsCreate.test.ts`
- `test/api/fetchRunsTrigger.test.ts`
- `app/(app)/fetch/FetchClient.tsx`
- `app/(app)/fetch/FetchClient.test.tsx`
- `messages/en.json`
- `messages/zh.json`
- `components/landing/lib/useCtaHref.ts`
- `components/landing/lib/useCtaHref.test.tsx`
- `components/landing/Nav.tsx`
- `components/landing/Hero.tsx`
- `components/landing/Cta.tsx`
- `README.md`
- `docs/superpowers/specs/2026-07-13-open-free-self-service-design.md`

## Commits

- `8233aa5` — `fix(fetch): enforce persistent run quotas`
- `docs(review): record final fix verification` — this report commit

## Concerns

- The controller still needs to run the repository-wide suite and production build.
- The advisory-lock order and SQL shape are covered with a fake transaction client;
  this fix wave did not run a live-database concurrency stress test.
